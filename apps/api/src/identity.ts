// Kimlik yüzeyi kurulumu (040 §12.1 adım 5–8): Valkey bağlantıları, hız sınırlayıcı, e-posta
// üreticisi, `appAuth` ve `/me` servisleri. `main.ts` ve entegrasyon testleri aynı kurucuyu kullanır.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { EdaEnv } from '@eda/contracts/config/env';
import { parseKekFile } from '@eda/crypto';
import { withNoTenant, withTenant, withUserScope } from '@eda/db';
import { createKeyring } from '@eda/db/keyring';
import { type ObjectStore, ObjectStoreError } from '@eda/db/s3';
import type { EdaLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import type { IdentitySurfaceDeps } from './app.ts';
import { createAuditWriter } from './auth/audit.ts';
import {
  type AppAuthDeps,
  createIdentity,
  defaultAuthDb,
  type Identity,
  valkeyReplayGuard,
  valkeySecondaryStorage,
} from './auth/index.ts';
import { truncateIp } from './auth/net.ts';
import { valkeyDownloadTokenStore } from './clients/download-tokens.ts';
import { valkeyIdempotencyStore } from './middleware/idempotency.ts';
import { RateLimiter } from './middleware/rate-limit.ts';
import { uuidv7 } from './middleware/request-id.ts';
import { createFileJobProducer, type FileJobProducer } from './queue/file-producer.ts';
import { createEmailProducer, type EmailProducer } from './queue/producer.ts';
import { createAiKeysService } from './services/ai-keys/ai-keys.ts';
import { anthropicVerifier, type KeyVerifier } from './services/ai-keys/crypto.ts';
import type { PlatformSettingsProvider } from './services/ai-keys/platform-settings.ts';
import { createAnnouncementsService } from './services/announcements/active.ts';
import { createCalendarService } from './services/calendar/calendar.ts';
import { createCasesService } from './services/cases/cases.ts';
import { createChatAttachments } from './services/chat/attachments.ts';
import { PgChatPersistence } from './services/chat/pg-persistence.ts';
import { createDocumentsService } from './services/documents/documents.ts';
import { createFilesService, type FilesLimits } from './services/files/files.ts';
import { submitLawyerApplication } from './services/lawyer-application.ts';
import { buildMe } from './services/me.ts';
import {
  createApplicationReceivedSender,
  createAuthEmails,
} from './services/notifications/auth-emails.ts';
import type { EmailEnqueueDeps } from './services/notifications/email-enqueue.ts';
import { createNotificationInboxService } from './services/notifications/inbox.ts';
import { createNotificationPreferencesService } from './services/notifications/preferences.ts';
import { createOrgService } from './services/org/org.ts';

export interface IdentitySetupInput {
  readonly edaEnv: EdaEnv;
  readonly appUrl: string;
  readonly baseURL: string;
  readonly secret: string;
  /** WebAuthn RP kimliği (`PASSKEY_RP_ID`). */
  readonly passkeyRpId: string;
  readonly kekFileContent: string;
  readonly hmacKey: Buffer;
  readonly redis: Redis;
  readonly queueRedis: Redis;
  readonly logger: EdaLogger;
  readonly rerankEnabled: boolean;
  readonly maintenance: () => boolean;
  readonly authDb?: AppAuthDeps['db'];
  readonly now?: () => Date;
  /** Testler için: Anthropic anahtar doğrulamasını değiştirir (varsayılan gerçek çağrı). */
  readonly verifyAiKey?: KeyVerifier;
  /**
   * Platform ortak anahtarı sağlayıcısı: DB anahtarı > sır dosyası; sert kapı (env) ve panel
   * anahtarı kapalıyken anahtar vermez. Verilmezse düşüş yoktur.
   */
  readonly platformSettings?: PlatformSettingsProvider | null;
  /**
   * Kimlik e-postası günlük tavanları (`email.globalDailyCap`, `email.perIpDailyCap`); verilmezse
   * kanonik varsayılan. Testler tavanı yükseltebilir veya daraltabilir.
   */
  readonly emailDailyCaps?: { readonly global: number; readonly perIp: number };
  /** Evrak nesne deposu (`eda-files`); verilmezse yükleme/indirme 503 `storage` (fail-closed). */
  readonly objectStore?: ObjectStore;
  /** Testler için: evrak sınırlarını (boyut, sayı, eşzamanlılık) daraltır. */
  readonly filesLimits?: Partial<FilesLimits>;
}

/** Nesne deposu yapılandırılmamışsa her işlem `unavailable`: sessizce başarılı sayılmaz. */
const UNAVAILABLE_STORE: ObjectStore = {
  put: async () => {
    throw new ObjectStoreError('unavailable');
  },
  get: async () => {
    throw new ObjectStoreError('unavailable');
  },
  head: async () => {
    throw new ObjectStoreError('unavailable');
  },
  delete: async () => {
    throw new ObjectStoreError('unavailable');
  },
  copy: async () => {
    throw new ObjectStoreError('unavailable');
  },
};

export interface IdentitySetup {
  readonly surface: IdentitySurfaceDeps;
  readonly identity: Identity;
  readonly rate: RateLimiter;
  readonly producer: EmailProducer;
  readonly fileProducer: FileJobProducer;
  readonly enqueue: EmailEnqueueDeps;
}

export function setupIdentity(input: IdentitySetupInput): IdentitySetup {
  const now = input.now ?? (() => new Date());
  const kek = parseKekFile(input.kekFileContent);
  const appDb = { withTenant, withUserScope, withNoTenant };
  const sysAudit = createAuditWriter(appDb, input.logger);
  const rate = new RateLimiter({
    redis: input.redis,
    hmacKey: input.hmacKey,
    now: () => now().getTime(),
    // Hesap başına küresel başarısız deneme eşiği aşıldı: dağıtık deneme göstergesi (kimlik yazılmaz).
    onGlobalThreshold: ({ ip }) => {
      void sysAudit({
        action: 'auth.login.failure',
        targetType: 'session',
        targetId: null,
        metadata: { reason: 'account_backoff' },
        ipTrunc: truncateIp(ip),
      });
    },
  });
  const producer = createEmailProducer(input.queueRedis, input.logger);
  const fileProducer = createFileJobProducer(input.queueRedis, input.logger);
  const enqueue: EmailEnqueueDeps = {
    withUserScope,
    producer,
    kek: kek.kek,
    newId: () => uuidv7(),
  };
  const emails = createAuthEmails({ enqueue, allowAuthEmail: (e) => rate.allowAuthEmail(e), now });
  const identity = createIdentity({
    baseURL: input.baseURL,
    appUrl: input.appUrl,
    secret: input.secret,
    passkeyRpId: input.passkeyRpId,
    db: input.authDb ?? defaultAuthDb(),
    storage: valkeySecondaryStorage(input.redis),
    replay: valkeyReplayGuard(input.redis),
    rate,
    kek: { kek: kek.kek, kekVersion: kek.kekVersion },
    appDb,
    emails,
    logger: input.logger,
    now,
  });
  const sendReceived = createApplicationReceivedSender(enqueue, now);
  const org = createOrgService({
    org: identity.org,
    db: appDb,
    emails,
    audit: createAuditWriter(appDb, input.logger),
    allowEmail: (e) => rate.allowAuthEmail(e),
    now,
  });
  const aiKeys = createAiKeysService({
    db: appDb,
    kek: { kek: kek.kek, kekVersion: kek.kekVersion },
    verify: input.verifyAiKey ?? anthropicVerifier(),
    // Dakikada 5 doğrulama: anahtar doğrulama ucu kâhin olarak kullanılamaz.
    limitVerify: (userId) => rate.enforce('step-up', `ai-key:${userId}`, 5, 60_000),
    audit: createAuditWriter(appDb, input.logger),
    now,
    platform: input.platformSettings ?? null,
  });
  const surface: IdentitySurfaceDeps = {
    appUrl: input.appUrl,
    identity,
    rate,
    emailDailyCaps: input.emailDailyCaps ?? {
      global: CONFIG_DEFAULTS['email.globalDailyCap'],
      perIp: CONFIG_DEFAULTS['email.perIpDailyCap'],
    },
    tenantDb: { withTenant, withUserScope },
    idempotency: valkeyIdempotencyStore(input.redis),
    org,
    documents: createDocumentsService({ db: appDb, now }),
    calendar: createCalendarService({ db: appDb, now }),
    cases: createCasesService({ db: appDb }),
    files: createFilesService({
      db: appDb,
      store: input.objectStore ?? UNAVAILABLE_STORE,
      keyring: createKeyring({ keks: [{ kek: kek.kek, kekVersion: kek.kekVersion }] }),
      jobs: fileProducer,
      tokens: valkeyDownloadTokenStore(input.redis),
      onIntegrityFailure: (e) =>
        input.logger.error({ event: 'file.integrity_failed', fileId: e.fileId, kind: e.kind }),
      edaEnv: input.edaEnv,
      uuid: () => uuidv7(),
      now,
      ...(input.filesLimits === undefined ? {} : { limits: input.filesLimits }),
    }),
    notificationPreferences: createNotificationPreferencesService({ db: appDb }),
    notificationInbox: createNotificationInboxService({ db: appDb }),
    announcements: createAnnouncementsService({ db: appDb }),
    aiKeys,
    chatPersistence: new PgChatPersistence(appDb),
    chatAttachments: createChatAttachments({ db: appDb }),
    audit: createAuditWriter(appDb, input.logger),
    me: {
      me: async (ctx) =>
        buildMe(
          appDb,
          {
            session: ctx.session,
            tenant:
              ctx.tenant === null
                ? null
                : { orgId: ctx.tenant.orgId, memberRole: ctx.tenant.memberRole },
          },
          {
            edaEnv: input.edaEnv,
            rerankEnabled: input.rerankEnabled,
            maintenance: input.maintenance(),
          },
          await identity.mfaFactors(ctx.session.userId),
        ),
      applyLawyer: (ctx, body) =>
        submitLawyerApplication(
          { db: appDb, writes: identity.writes, sendReceived, now },
          {
            userId: ctx.session.userId,
            verificationStatus: ctx.user.verificationStatus,
            individualOrgId:
              ctx.tenant !== null &&
              ctx.tenant.orgKind === 'individual' &&
              ctx.tenant.memberRole === 'owner'
                ? ctx.tenant.orgId
                : null,
          },
          body,
        ),
    },
  };
  return { surface, identity, rate, producer, fileProducer, enqueue };
}
