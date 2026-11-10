// Yapay zekâ API anahtarı servisi (#54 BYOK): büro/baro anahtarı (yalnız `org:ai_policy_write`, yani
// sahip ve yönetici) ve kullanıcının kendi anahtarı. Şifreleme bağlamları `crypto.ts`'tedir. Düz metin
// anahtar yalnız şifreleme/doğrulama süresince bellekte tutulur ve sıfırlanır. Yanıtlar yalnız son 4
// karakteri taşır. Hono bilmez.
import type { AiKeysStatusDtoValue } from '@eda/contracts/api/ai-keys';
import type { MemberRole } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import { can } from '@eda/contracts/permissions';
import { encryptField, unwrapDek, wipe } from '@eda/crypto';
import * as repo from '../../repositories/ai-keys/ai-keys.ts';
import { deriveUserKey, last4Of, orgKeyContext, userKeyContext } from './crypto.ts';
import { resolveKey } from './resolve.ts';
import type { AiKeysActor, AiKeysDeps, AiKeysResolveActor } from './types.ts';

export type { AiKeysActor, AiKeysDb, AiKeysDeps, KeyOrigin, ResolvedKey } from './types.ts';

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

const canManageOrg = (role: MemberRole): boolean =>
  can({ surface: 'app', memberRole: role }, 'org:ai_policy_write').allow;

export function createAiKeysService(deps: AiKeysDeps) {
  const tenant = (a: AiKeysActor) => ({ orgId: a.orgId, userId: a.userId });
  const slotDto = (s: repo.KeySlotRow) => ({
    configured: s.enc !== null,
    last4: s.last4,
    verifiedAt: iso(s.verifiedAt),
  });

  async function status(a: AiKeysActor): Promise<AiKeysStatusDtoValue> {
    const org = await deps.db.withTenant(tenant(a), (tx) => repo.readOrgSlot(tx, a.orgId));
    const own = await deps.db.withUserScope({ userId: a.userId }, (tx) =>
      repo.readUserSlot(tx, a.userId),
    );
    const selected = own.source === 'org' ? org.enc !== null : own.enc !== null;
    // Platform ayarı okunamazsa durum yine döner (düşüş yok sayılır); sohbet yolu ayrıca fail-closed çalışır.
    const platform = await deps.platform?.get().catch(() => null);
    const platformFallback = platform?.enabled === true && platform.apiKey !== null;
    const effectiveSource = selected ? own.source : platformFallback ? ('platform' as const) : null;
    return {
      org: slotDto(org),
      own: slotDto(own),
      source: own.source,
      canManageOrg: canManageOrg(a.memberRole),
      usable: effectiveSource !== null,
      effectiveSource,
      platformFallback,
      platformLabel: platformFallback ? (platform?.label ?? null) : null,
    };
  }

  /** Anahtarı sağlayıcıda doğrular: reddedildiyse 422 `api_key_rejected`, ulaşılamadıysa 503. */
  async function verified(a: AiKeysActor, apiKey: string): Promise<void> {
    // Doğrulama ucu çalıntı anahtar denemek için kâhin olarak kullanılmasın: kullanıcı başı sınır.
    await deps.limitVerify?.(a.userId);
    let ok: boolean;
    try {
      ok = await deps.verify(apiKey);
    } catch {
      throw new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE', {
        reason: 'timeout',
        meta: { retryAfterSec: 30 },
      });
    }
    if (!ok) throw new AppError('VALIDATION_FAILED', { reason: 'api_key_rejected' });
  }

  const orgAudit = (a: AiKeysActor, change: 'set' | 'removed') =>
    deps.audit({
      action: 'org.settings.changed',
      userId: a.userId,
      orgId: a.orgId,
      targetType: 'org_settings',
      targetId: a.orgId,
      // Anahtar değeri kayda yazılmaz; yalnız alan adı ve değişiklik türü.
      metadata: { field: 'ai_api_key', change },
    });

  async function setOrgKey(a: AiKeysActor, apiKey: string): Promise<AiKeysStatusDtoValue> {
    if (!canManageOrg(a.memberRole)) throw new AppError('ORG_ROLE_INSUFFICIENT');
    await verified(a, apiKey);
    const at = deps.now();
    await deps.db.withTenant(tenant(a), async (tx) => {
      const dek = await repo.readActiveDek(tx, a.orgId);
      if (dek === null) throw new AppError('INTERNAL_ERROR');
      const raw = unwrapDek(
        deps.kek.kek,
        { orgId: a.orgId, dekVersion: dek.keyVersion, kekVersion: dek.kekVersion },
        dek.wrapped,
      );
      try {
        const enc = encryptField(raw, orgKeyContext(a.orgId, dek.keyVersion), apiKey);
        const rows = await repo.writeOrgSlot(tx, a.orgId, a.userId, {
          enc,
          last4: last4Of(apiKey),
          version: dek.keyVersion,
          verifiedAt: at,
        });
        if (rows === 0) throw new AppError('INTERNAL_ERROR');
      } finally {
        wipe(raw);
      }
    });
    await orgAudit(a, 'set');
    return status(a);
  }

  async function removeOrgKey(a: AiKeysActor): Promise<AiKeysStatusDtoValue> {
    if (!canManageOrg(a.memberRole)) throw new AppError('ORG_ROLE_INSUFFICIENT');
    await deps.db.withTenant(tenant(a), (tx) => repo.writeOrgSlot(tx, a.orgId, a.userId, null));
    await orgAudit(a, 'removed');
    return status(a);
  }

  async function setOwnKey(a: AiKeysActor, apiKey: string): Promise<AiKeysStatusDtoValue> {
    await verified(a, apiKey);
    const at = deps.now();
    const key = deriveUserKey(deps.kek.kek, a.userId);
    try {
      const version = deps.kek.kekVersion;
      const enc = encryptField(key, userKeyContext(a.userId, version), apiKey);
      await deps.db.withUserScope({ userId: a.userId }, (tx) =>
        repo.upsertUserSlot(tx, a.userId, {
          key: { enc, last4: last4Of(apiKey), version, verifiedAt: at },
        }),
      );
    } finally {
      wipe(key);
    }
    return status(a);
  }

  async function removeOwnKey(a: AiKeysActor): Promise<AiKeysStatusDtoValue> {
    await deps.db.withUserScope({ userId: a.userId }, (tx) =>
      repo.upsertUserSlot(tx, a.userId, { key: null, source: 'org' }),
    );
    return status(a);
  }

  async function setSource(a: AiKeysActor, source: 'org' | 'own'): Promise<AiKeysStatusDtoValue> {
    await deps.db.withUserScope({ userId: a.userId }, (tx) =>
      repo.upsertUserSlot(tx, a.userId, { source }),
    );
    return status(a);
  }

  return {
    status,
    setOrgKey,
    removeOrgKey,
    setOwnKey,
    removeOwnKey,
    setSource,
    resolve: (a: AiKeysResolveActor) => resolveKey(deps, a),
  };
}

export type AiKeysService = ReturnType<typeof createAiKeysService>;
