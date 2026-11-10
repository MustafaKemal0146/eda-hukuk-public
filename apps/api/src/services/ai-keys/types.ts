// Yapay zekâ API anahtarı servisi tipleri (#54 BYOK).
import type { MemberRole } from '@eda/contracts/enums';
import type { TenantTx, UserTx } from '@eda/db';
import type { AuditWriter } from '../../auth/audit.ts';
import type { KeyVerifier } from './crypto.ts';
import type { PlatformSettingsProvider } from './platform-settings.ts';

export interface AiKeysDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
  withUserScope<T>(ctx: { userId: string }, fn: (tx: UserTx) => Promise<T>): Promise<T>;
}

export interface AiKeysActor {
  readonly orgId: string;
  readonly userId: string;
  readonly memberRole: MemberRole;
}

export interface AiKeysDeps {
  readonly db: AiKeysDb;
  readonly kek: { readonly kek: Buffer; readonly kekVersion: number };
  readonly verify: KeyVerifier;
  /** Kullanıcı başı doğrulama sınırı (aşımda 429 fırlatır); yoksa sınırsız (testler). */
  readonly limitVerify?: (userId: string) => Promise<void>;
  readonly audit: AuditWriter;
  readonly now: () => Date;
  /**
   * Platform ortak anahtarı. Verilmezse (ya da sert/yumuşak kapı kapalıysa) büro ve kullanıcı
   * anahtarı yokken eski davranış (anahtar yok hatası) sürer. Sağlayıcı: DB anahtarı > sunucu sır dosyası.
   */
  readonly platform?: PlatformSettingsProvider | null;
}

/** Anahtar çözümü yalnız büro ve kullanıcı kimliğini ister (rol gerekmez). */
export type AiKeysResolveActor = Pick<AiKeysActor, 'orgId' | 'userId'>;

/** Çözülmüş anahtarın kaynağı; `platform` = sunucunun ortak anahtarı (yalnız açık bayrakla, limitli). */
export type KeyOrigin = 'org' | 'own' | 'platform';

/**
 * Sohbet için çözülmüş anahtar veya eksik kaynak. Platform anahtarına düşüş YALNIZ `deps.platform`
 * verilmişse olur (açık bayrak) ve kaynak her zaman `platform` olarak işaretlenir; sessiz düşme yoktur.
 */
export type ResolvedKey =
  | { readonly apiKey: string; readonly source: KeyOrigin }
  | { readonly missing: 'org' | 'own' };
