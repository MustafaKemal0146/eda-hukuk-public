// Yönetim "Yapay zekâ anahtar ataması" servisi: süper yönetici bir büroya/baroya ya da kullanıcıya
// Anthropic API anahtarı atar veya siler; ayrıca PLATFORM ortak anahtarını girer/değiştirir/siler, ona ad verir,
// düşüşü açıp kapatır ve platform geneli günlük sınırları ayarlar (`app.platform_settings`; anahtar KEK
// türevli anahtarla şifreli, AAD `platform_ai_key` + sürüm). Şifreleme mevcut BYOK yoluyla yapılır (büro DEK'i `org` yuvası,
// KEK'ten türeyen kullanıcı anahtarı `own` yuvası; bağlamlar `services/ai-keys/crypto.ts`); bu servis yeni
// kripto yazmaz. Düz metin anahtar yalnız doğrulama ve şifreleme süresince bellekte durur, sıfırlanır;
// DB'ye şifreli değer, `app.admin_ai_key_*` SECURITY DEFINER fonksiyonlarıyla yazılır ve ASLA geri okunmaz.
// Yanıtlar yalnız tanımlı/yok, son 4 karakter ve zaman taşır. Denetim kaydı veritabanı işleminde yazılır
// (system_setting.changed / ai_key); anahtar değeri ve son 4 hane denetime ve loga yazılmaz.
import type {
  AdminAiKeyOrgItemDtoValue,
  AdminAiKeyOrgListResponseValue,
  AdminAiKeyUserItemDtoValue,
  AdminAiKeyUserListResponseValue,
  AdminAiPlatformCapInputValue,
  AdminAiPlatformKeyDtoValue,
  AdminAiPlatformLimitsInputValue,
} from '@eda/contracts/api/admin-ai-keys';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { VerificationStatus } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import { encryptField, unwrapDek, wipe } from '@eda/crypto';
import type { AdminDb } from '@eda/db/admin';
import {
  derivePlatformKey,
  deriveUserKey,
  type KeyVerifier,
  last4Of,
  orgKeyContext,
  platformKeyContext,
  userKeyContext,
} from '../services/ai-keys/crypto.ts';

export interface AdminAiKeysServiceDeps {
  readonly db: AdminDb;
  readonly kek: { readonly kek: Buffer; readonly kekVersion: number };
  /** Anthropic doğrulaması (egress/IP politikası altında; `anthropicVerifier`). */
  readonly verify: KeyVerifier;
  /** Yönetici başına doğrulama hız sınırı (aşımda 429 fırlatır). */
  readonly limitVerify?: (actorId: string) => Promise<void>;
  /**
   * Platform ortak anahtarı: sert kapı (env) açık mı, sunucu sır dosyası tanımlı mı (değer değil) ve
   * yönetim yazmasından sonra sohbet yolunun önbelleğini düşüren geri çağrı.
   */
  readonly platform: {
    readonly envGateOpen: boolean;
    readonly fileKeyConfigured: () => boolean;
    readonly onChanged?: () => void;
  };
  readonly now: () => Date;
}

type Row = Record<string, unknown>;

const DEFAULT_LIMIT = 25;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : (v instanceof Date ? v : new Date(String(v))).toISOString();
const slot = (last4: unknown, at: unknown) => ({
  configured: typeof last4 === 'string',
  last4: typeof last4 === 'string' ? last4 : null,
  updatedAt: iso(at),
});

function sqlState(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

/** Veritabanı hatasını kamuya açık hataya çevirir (iç ayrıntı sızmaz). */
function mapDbError(err: unknown, resource: 'org' | 'user' | 'platform_key'): never {
  switch (sqlState(err)) {
    case '42501':
    case '55000':
      throw new AppError('ADMIN_FORBIDDEN', { reason: 'permission_missing' });
    case 'P0002':
      // Platform anahtarı yokken yeniden adlandırma: kanonik 'provider' nedeni (yeni neden eklenmez).
      throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', {
        reason: resource === 'platform_key' ? 'provider' : resource,
      });
    case '22023':
      throw new AppError('VALIDATION_FAILED');
    default:
      throw err;
  }
}

export function createAdminAiKeysService(deps: AdminAiKeysServiceDeps) {
  const orgItem = (x: Row): AdminAiKeyOrgItemDtoValue => {
    const id = String(x.org_id);
    return {
      orgId: id,
      shortId: id.slice(-8),
      orgLabel: String(x.org_label),
      orgKind: String(x.org_kind),
      key: slot(x.key_last4, x.key_set_at),
    };
  };
  const userItem = (x: Row): AdminAiKeyUserItemDtoValue => {
    const id = String(x.user_id);
    return {
      userId: id,
      shortId: id.slice(-8),
      userEmail: String(x.user_email),
      verificationStatus: x.verification_status as VerificationStatus,
      source: x.key_source === 'own' ? 'own' : 'org',
      key: slot(x.key_last4, x.key_set_at),
    };
  };

  async function orgRows(actorId: string, query: string | null, limit: number): Promise<Row[]> {
    try {
      const r = await deps.db.withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_ai_key_org_list($1, $2, $3)', [actorId, query, limit]),
      );
      return r.rows as Row[];
    } catch (err) {
      return mapDbError(err, 'org');
    }
  }

  async function userRows(actorId: string, query: string | null, limit: number): Promise<Row[]> {
    try {
      const r = await deps.db.withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_ai_key_user_list($1, $2, $3)', [actorId, query, limit]),
      );
      return r.rows as Row[];
    } catch (err) {
      return mapDbError(err, 'user');
    }
  }

  /** Anahtarı sağlayıcıda doğrular: reddedildiyse 422 `api_key_rejected`, ulaşılamadıysa 503. */
  async function verified(actorId: string, apiKey: string): Promise<void> {
    await deps.limitVerify?.(actorId);
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

  async function orgOne(actorId: string, orgId: string): Promise<AdminAiKeyOrgItemDtoValue> {
    const row = (await orgRows(actorId, orgId, 1))[0];
    if (row === undefined) throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'org' });
    return orgItem(row);
  }

  async function userOne(actorId: string, userId: string): Promise<AdminAiKeyUserItemDtoValue> {
    const row = (await userRows(actorId, userId, 1))[0];
    if (row === undefined) throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'user' });
    return userItem(row);
  }

  /** Kart: yönetim ayarı + son 24 saat toplamı. Şifreli değer okunmaz; ad ve son 4 hane yalnız kartta görünür. */
  async function platformCard(actorId: string): Promise<AdminAiPlatformKeyDtoValue> {
    let usage: Row | undefined;
    let cfg: Row | undefined;
    try {
      [usage, cfg] = await deps.db.withAdmin(async (tx) => {
        const u = await tx.query('SELECT * FROM app.admin_ai_platform_card($1)', [actorId]);
        const c = await tx.query('SELECT * FROM app.admin_platform_settings_card($1)', [actorId]);
        return [u.rows[0] as Row | undefined, c.rows[0] as Row | undefined] as const;
      });
    } catch (err) {
      return mapDbError(err, 'platform_key');
    }
    const hasKey = cfg?.has_key === true;
    const fileKey = deps.platform.fileKeyConfigured();
    const custom = {
      userTurnsPerDay: cfg?.user_turns_per_day == null ? null : n(cfg.user_turns_per_day),
      userTokensPerDay: cfg?.user_tokens_per_day == null ? null : n(cfg.user_tokens_per_day),
      orgDailyCapMicroUsd:
        cfg?.org_daily_cap_micro_usd == null ? null : n(cfg.org_daily_cap_micro_usd),
      platformDailyCapMicroUsd:
        cfg?.platform_daily_cap_micro_usd == null ? null : n(cfg.platform_daily_cap_micro_usd),
    };
    const defaults = {
      userTurnsPerDay: CONFIG_DEFAULTS['platformKey.userTurnsPerDay'],
      userTokensPerDay: CONFIG_DEFAULTS['platformKey.userTokensPerDay'],
      orgDailyCapFloorMicroUsd: CONFIG_DEFAULTS['costGuard.orgDailyCapFloorMicroUsd'],
      orgDailyCapPerSeatMicroUsd: CONFIG_DEFAULTS['costGuard.orgDailyCapPerSeatMicroUsd'],
      platformDailyCapMicroUsd: CONFIG_DEFAULTS['costGuard.platformDailyCapMicroUsd'],
    };
    const keyConfigured = hasKey || fileKey;
    const switchOn = cfg?.fallback_enabled !== false;
    return {
      fallbackEnabled: deps.platform.envGateOpen,
      fallbackSwitch: switchOn,
      keyConfigured,
      active: deps.platform.envGateOpen && switchOn && keyConfigured,
      key: {
        source: hasKey ? 'panel' : fileKey ? 'server_secret' : null,
        label: hasKey && typeof cfg?.key_label === 'string' ? cfg.key_label : null,
        last4: hasKey && typeof cfg?.key_last4 === 'string' ? cfg.key_last4 : null,
        updatedAt: hasKey ? iso(cfg?.key_updated_at) : null,
      },
      last24h: {
        turns: n(usage?.turns),
        users: n(usage?.users),
        orgs: n(usage?.orgs),
        tokens: n(usage?.tokens),
        estimatedCostMicroUsd: n(usage?.cost_micro_usd),
      },
      limits: {
        userTurnsPerDay: custom.userTurnsPerDay ?? defaults.userTurnsPerDay,
        userTokensPerDay: custom.userTokensPerDay ?? defaults.userTokensPerDay,
        orgDailyCapMicroUsd: custom.orgDailyCapMicroUsd,
        platformDailyCapMicroUsd:
          custom.platformDailyCapMicroUsd ?? defaults.platformDailyCapMicroUsd,
        estimatedMicroUsdPerMtok: CONFIG_DEFAULTS['platformKey.estimatedMicroUsdPerMtok'],
        custom,
        defaults,
      },
    };
  }

  return {
    async listOrgs(
      actorId: string,
      query: string | null,
      limit?: number,
    ): Promise<AdminAiKeyOrgListResponseValue> {
      return { items: (await orgRows(actorId, query, limit ?? DEFAULT_LIMIT)).map(orgItem) };
    },

    async listUsers(
      actorId: string,
      query: string | null,
      limit?: number,
    ): Promise<AdminAiKeyUserListResponseValue> {
      return { items: (await userRows(actorId, query, limit ?? DEFAULT_LIMIT)).map(userItem) };
    },

    async setOrgKey(
      actorId: string,
      orgId: string,
      apiKey: string,
    ): Promise<AdminAiKeyOrgItemDtoValue> {
      // Hedef yoksa/aktör yetkisizse sağlayıcıya hiç gidilmez.
      await orgOne(actorId, orgId);
      await verified(actorId, apiKey);
      let dek: Row | undefined;
      try {
        const r = await deps.db.withAdmin((tx) =>
          tx.query('SELECT * FROM app.admin_ai_key_org_dek($1, $2)', [actorId, orgId]),
        );
        dek = r.rows[0] as Row | undefined;
      } catch (err) {
        return mapDbError(err, 'org');
      }
      if (dek === undefined || !Buffer.isBuffer(dek.wrapped_dek)) {
        throw new AppError('INTERNAL_ERROR');
      }
      const keyVersion = n(dek.key_version);
      const raw = unwrapDek(
        deps.kek.kek,
        { orgId, dekVersion: keyVersion, kekVersion: n(dek.kek_version) },
        dek.wrapped_dek,
      );
      try {
        const enc = encryptField(raw, orgKeyContext(orgId, keyVersion), apiKey);
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_ai_key_org_set($1, $2, $3, $4, $5, $6)', [
            actorId,
            orgId,
            enc,
            last4Of(apiKey),
            keyVersion,
            deps.now(),
          ]),
        );
      } catch (err) {
        return mapDbError(err, 'org');
      } finally {
        wipe(raw);
      }
      return orgOne(actorId, orgId);
    },

    async removeOrgKey(actorId: string, orgId: string): Promise<AdminAiKeyOrgItemDtoValue> {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_ai_key_org_clear($1, $2)', [actorId, orgId]),
        );
      } catch (err) {
        return mapDbError(err, 'org');
      }
      return orgOne(actorId, orgId);
    },

    async setUserKey(
      actorId: string,
      userId: string,
      apiKey: string,
    ): Promise<AdminAiKeyUserItemDtoValue> {
      await userOne(actorId, userId);
      await verified(actorId, apiKey);
      const key = deriveUserKey(deps.kek.kek, userId);
      try {
        const version = deps.kek.kekVersion;
        const enc = encryptField(key, userKeyContext(userId, version), apiKey);
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_ai_key_user_set($1, $2, $3, $4, $5, $6)', [
            actorId,
            userId,
            enc,
            last4Of(apiKey),
            version,
            deps.now(),
          ]),
        );
      } catch (err) {
        return mapDbError(err, 'user');
      } finally {
        wipe(key);
      }
      return userOne(actorId, userId);
    },

    async removeUserKey(actorId: string, userId: string): Promise<AdminAiKeyUserItemDtoValue> {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_ai_key_user_clear($1, $2)', [actorId, userId]),
        );
      } catch (err) {
        return mapDbError(err, 'user');
      }
      return userOne(actorId, userId);
    },

    /** Platform ortak anahtarı kartı: değer ASLA dönmez (yalnız durum, ad, son 4 hane, zaman, toplamlar). */
    platformCard,

    async setPlatformKey(
      actorId: string,
      apiKey: string,
      label: string,
    ): Promise<AdminAiPlatformKeyDtoValue> {
      // Aktör yetkisiz/personel değilse sağlayıcıya hiç gidilmez (kart fonksiyonu aktörü doğrular).
      await platformCard(actorId);
      await verified(actorId, apiKey);
      const key = derivePlatformKey(deps.kek.kek);
      try {
        const version = deps.kek.kekVersion;
        const enc = encryptField(key, platformKeyContext(version), apiKey);
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_platform_key_set($1, $2, $3, $4, $5, $6)', [
            actorId,
            enc,
            last4Of(apiKey),
            version,
            label,
            deps.now(),
          ]),
        );
      } catch (err) {
        return mapDbError(err, 'platform_key');
      } finally {
        wipe(key);
      }
      deps.platform.onChanged?.();
      return platformCard(actorId);
    },

    async renamePlatformKey(actorId: string, label: string): Promise<AdminAiPlatformKeyDtoValue> {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_platform_key_label_set($1, $2)', [actorId, label]),
        );
      } catch (err) {
        return mapDbError(err, 'platform_key');
      }
      deps.platform.onChanged?.();
      return platformCard(actorId);
    },

    async removePlatformKey(actorId: string): Promise<AdminAiPlatformKeyDtoValue> {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_platform_key_clear($1)', [actorId]),
        );
      } catch (err) {
        return mapDbError(err, 'platform_key');
      }
      deps.platform.onChanged?.();
      return platformCard(actorId);
    },

    async setPlatformFallback(
      actorId: string,
      enabled: boolean,
    ): Promise<AdminAiPlatformKeyDtoValue> {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_platform_fallback_set($1, $2)', [actorId, enabled]),
        );
      } catch (err) {
        return mapDbError(err, 'platform_key');
      }
      deps.platform.onChanged?.();
      return platformCard(actorId);
    },

    /** Platform geneli günlük harcama tavanı (`null` = varsayılan); sohbet yolu önbelleği hemen düşer. */
    async setPlatformCap(
      actorId: string,
      input: AdminAiPlatformCapInputValue,
    ): Promise<AdminAiPlatformKeyDtoValue> {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_platform_cap_set($1, $2)', [
            actorId,
            input.platformDailyCapMicroUsd,
          ]),
        );
      } catch (err) {
        return mapDbError(err, 'platform_key');
      }
      deps.platform.onChanged?.();
      return platformCard(actorId);
    },

    async setPlatformLimits(
      actorId: string,
      limits: AdminAiPlatformLimitsInputValue,
    ): Promise<AdminAiPlatformKeyDtoValue> {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_platform_limits_set($1, $2, $3, $4)', [
            actorId,
            limits.userTurnsPerDay,
            limits.userTokensPerDay,
            limits.orgDailyCapMicroUsd,
          ]),
        );
      } catch (err) {
        return mapDbError(err, 'platform_key');
      }
      deps.platform.onChanged?.();
      return platformCard(actorId);
    },
  };
}

export type AdminAiKeysService = ReturnType<typeof createAdminAiKeysService>;
