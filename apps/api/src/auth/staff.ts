// Personel hesabı komutları (042 §3.4, §10.3; P27a): `create-staff` parolasız personel kullanıcısı
// açar ve tek kullanımlık passkey kayıt belirteci üretir; `staff-reenroll` eski passkey ve oturumları
// siler, yeni belirteç üretir. Personel rolü başka hiçbir yoldan verilmez (API ve Better Auth rol
// uçları kapalı). `staff-promote` mevcut, doğrulanmış, TOTP'si etkin uygulama hesabını personel
// yapar (parola + TOTP ile yönetim girişi). Çıktı yalnız kullanıcı kimliğinin son 8 hanesi ve belirteç özetidir.
import { normalizeEmail } from '@eda/legal/text';
import { and, eq } from 'drizzle-orm';
import { STAFF_ROLES } from './admin-auth.ts';
import type { AuditEvent } from './audit.ts';
import { AUTH_TABLES, type AuthDb } from './auth-db.ts';

export class StaffError extends Error {
  override name = 'StaffError';
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

export interface StaffDeps {
  readonly db: AuthDb;
  readonly issueEnrollmentToken: (userId: string) => Promise<{ token: string; expiresAt: Date }>;
  /** Oturumları Better Auth yolundan (DB + Valkey) siler; doğrudan DB silmek Valkey'de iz bırakır. */
  readonly revokeAllSessions: (userId: string) => Promise<void>;
  readonly adminUrl: string;
}

export interface StaffResult {
  readonly userIdSuffix: string;
  /** Kayıt bağlantısı (belirteç URL parçasındadır; günlüğe yazılmaz). */
  readonly enrollmentUrl: string;
  readonly expiresAt: Date;
}

const enrollmentUrl = (adminUrl: string, token: string) =>
  `${adminUrl.replace(/\/$/, '')}/giris#kayit=${token}`;

export async function createStaff(
  deps: StaffDeps,
  args: { email: string; name: string; role: string },
): Promise<StaffResult> {
  const email = normalizeEmail(args.email);
  if (email === null) throw new StaffError('geçersiz e-posta: yalnız ASCII adres kabul edilir', 2);
  const name = args.name.trim();
  if (name.length < 2 || name.length > 100) throw new StaffError('ad 2-100 karakter olmalı', 2);
  if (!(STAFF_ROLES as readonly string[]).includes(args.role)) {
    throw new StaffError('rol super_admin veya support olmalı', 2);
  }
  const { users } = AUTH_TABLES;
  const [existing] = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing !== undefined) throw new StaffError('bu e-postayla hesap zaten var', 4);
  const [row] = await deps.db
    .insert(users)
    .values({
      name,
      email,
      emailVerified: true,
      platformRole: args.role,
      verificationStatus: 'verified',
    })
    .returning({ id: users.id });
  if (row === undefined) throw new StaffError('hesap oluşturulamadı', 1);
  const t = await deps.issueEnrollmentToken(row.id);
  return {
    userIdSuffix: row.id.slice(-8),
    enrollmentUrl: enrollmentUrl(deps.adminUrl, t.token),
    expiresAt: t.expiresAt,
  };
}

export async function reenrollStaff(
  deps: StaffDeps,
  args: { email: string },
): Promise<StaffResult> {
  const email = normalizeEmail(args.email);
  if (email === null) throw new StaffError('geçersiz e-posta', 2);
  const { users, passkeys } = AUTH_TABLES;
  const [u] = await deps.db
    .select({ id: users.id, role: users.platformRole })
    .from(users)
    .where(eq(users.email, email));
  if (u === undefined || !(STAFF_ROLES as readonly string[]).includes(u.role)) {
    throw new StaffError('bu e-postayla personel hesabı bulunamadı', 4);
  }
  await deps.db.delete(passkeys).where(eq(passkeys.userId, u.id));
  await deps.revokeAllSessions(u.id);
  const t = await deps.issueEnrollmentToken(u.id);
  return {
    userIdSuffix: u.id.slice(-8),
    enrollmentUrl: enrollmentUrl(deps.adminUrl, t.token),
    expiresAt: t.expiresAt,
  };
}

export interface PromoteDeps {
  readonly db: AuthDb;
  readonly revokeAllSessions: (userId: string) => Promise<void>;
  /** Denetim satırı (platform zinciri, aktör sistem); yazılamazsa fırlatır ve rol DEĞİŞMEZ. */
  readonly audit: (e: AuditEvent) => Promise<void>;
}

export interface PromoteResult {
  readonly userIdSuffix: string;
  readonly role: string;
  /** Hesap zaten bu roldeydi; değişiklik ve denetim yok. */
  readonly unchanged: boolean;
}

/**
 * `staff-promote --email <e> --role super_admin|support`: yalnız e-postası doğrulanmış, yasaklı/askıda
 * olmayan ve TOTP'si ETKİN hesap yükseltilir (yönetim girişi parola + TOTP ister). Tüm oturumlar kapanır
 * (personel hesabı uygulama yüzeyinde oturum açamaz; 042 §2.2). Denetim satırı rolden ÖNCE yazılır.
 */
export async function promoteStaff(
  deps: PromoteDeps,
  args: { email: string; role: string },
): Promise<PromoteResult> {
  const email = normalizeEmail(args.email);
  if (email === null) throw new StaffError('geçersiz e-posta: yalnız ASCII adres kabul edilir', 2);
  if (!(STAFF_ROLES as readonly string[]).includes(args.role)) {
    throw new StaffError('rol super_admin veya support olmalı', 2);
  }
  const { users, twoFactors } = AUTH_TABLES;
  const [u] = await deps.db
    .select({
      id: users.id,
      role: users.platformRole,
      emailVerified: users.emailVerified,
      banned: users.banned,
      verificationStatus: users.verificationStatus,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(users)
    .where(eq(users.email, email));
  if (u === undefined) throw new StaffError('bu e-postayla hesap bulunamadı', 4);
  if (!u.emailVerified) {
    throw new StaffError('hesabın e-postası doğrulanmamış; önce uygulamada doğrulayın', 4);
  }
  if (u.banned || u.verificationStatus === 'suspended') {
    throw new StaffError('hesap askıda veya yasaklı; personel yapılamaz', 4);
  }
  const [tf] = await deps.db
    .select({ id: twoFactors.id })
    .from(twoFactors)
    .where(and(eq(twoFactors.userId, u.id), eq(twoFactors.verified, true)));
  if (!u.twoFactorEnabled || tf === undefined) {
    throw new StaffError(
      'hesapta 2 adımlı doğrulama (TOTP) etkin değil; önce uygulamada etkinleştirin',
      4,
    );
  }
  if (u.role === args.role) {
    return { userIdSuffix: u.id.slice(-8), role: args.role, unchanged: true };
  }
  await deps.audit({
    action: 'system_setting.changed',
    targetType: 'user',
    targetId: u.id,
    metadata: { setting: 'platform_role', from: u.role, to: args.role, via: 'cli' },
  });
  await deps.db.update(users).set({ platformRole: args.role }).where(eq(users.id, u.id));
  await deps.revokeAllSessions(u.id);
  return { userIdSuffix: u.id.slice(-8), role: args.role, unchanged: false };
}
