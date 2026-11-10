// `dev-sample-identity` (032 §11.2–§11.3; P04b; KK-P04b-13): örnek büro dünyasının KİMLİK kısmı
// (aşama `dev-sample`; yalnız `development`, `test` ortamında atlanır — profil kapısı `profile.ts`).
// Müvekkil/dava/sohbet/belge/takvim/bildirim/destek içerikleri ilgili ekran promptlarında ayrı
// `dev-sample-*` aşamalarıdır. İçerik sentetiktir ("Örnek …"); gerçek kişi yoktur.
//  - 11 kullanıcı (`<anahtar>@ornek.eda.localhost`, `email_verified = true`): Büro A'da owner, admin,
//    senior_lawyer, lawyer1, lawyer2, trainee, assistant; `solo` (bireysel büro); `pending`
//    (`pending_verification`, meslek başvurusu gönderilmiş; `make approve-user` için bireysel bürosu
//    vardır); `platform_admin` (`super_admin`), `platform_support` (`support`).
//  - Parola `DEV_SEED_PASSWORD_FILE` sırrından Argon2id (api `password.ts` ile aynı parametreler);
//    düz parola hiçbir yere yazılmaz. Platform hesaplarının parola kaydı YOKTUR.
//  - Bürolar `metadata = {"sampleData":true}`; `org_settings`, `org_keys` (DEK `KEK_MASTER_FILE` ile
//    sarılı); bayi "Örnek Bayi" (`ORNEK-BAYI`), kupon `ORNEK-BARO`; Büro A için çok koltuklu deneme
//    aboneliği + `trial_grant` (yalnız `SEED_RLS_EXCEPTIONS` yolu). Kimlikler `uuidv5(NS_SEED, ad)`.
//  - `auth.*` doğrudan (`eda_owner`, RLS yok); `app.*` sentetik üye bağıyla (`bindSeedContext`) ve
//    uygulamayla aynı politikalardan geçerek. Her adım idempotenttir (yeniden koşu `skipped`).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { parseKekFile, wipe, wrapDek } from '@eda/crypto';
import type { ClientBase } from 'pg';
import { EXIT, MigrateError } from '../../migrate/exit-codes.ts';
import { bindSeedContext } from '../../tenant.ts';
import { seedId } from '../ids.ts';
import { withSeedRlsException } from '../rls-exception.ts';
import type { SeedDef } from '../types.ts';
import { emptyCounts, type SeedCounts } from '../upsert.ts';

export const DEV_SAMPLE_DOMAIN = 'ornek.eda.localhost';
export const SAMPLE_METADATA = '{"sampleData":true}';
const PARTNER_CODE = 'ORNEK-BAYI';
const COUPON_CODE = 'ORNEK-BARO';
/** Büro A deneme aboneliği koltuk sayısı (7 üye + davet payı; örnek veri). */
export const SAMPLE_FIRM_SEATS = 10;
const SAMPLE_COUPON_PERCENT = 20;
/** Baro adı gerçek `BAROS` girdisidir (sicil numaraları sentetik). */
const SAMPLE_BARO = 'Ankara Barosu';

type Role = 'owner' | 'admin' | 'senior_lawyer' | 'lawyer' | 'trainee' | 'assistant';

interface SampleUser {
  readonly key: string;
  readonly name: string;
  readonly platformRole: 'user' | 'support' | 'super_admin';
  readonly status: 'verified' | 'pending_verification';
  /** Meslek profili: `sicil` veya `trainee` sicil numarası (sentetik). */
  readonly registry?: { readonly kind: 'sicil' | 'trainee'; readonly no: string };
}

export const SAMPLE_USERS: readonly SampleUser[] = [
  {
    key: 'owner',
    name: 'Örnek Büro Sahibi',
    platformRole: 'user',
    status: 'verified',
    registry: { kind: 'sicil', no: 'ORNEK-1001' },
  },
  {
    key: 'admin',
    name: 'Örnek Büro Yöneticisi',
    platformRole: 'user',
    status: 'verified',
    registry: { kind: 'sicil', no: 'ORNEK-1002' },
  },
  {
    key: 'senior_lawyer',
    name: 'Örnek Kıdemli Avukat',
    platformRole: 'user',
    status: 'verified',
    registry: { kind: 'sicil', no: 'ORNEK-1003' },
  },
  {
    key: 'lawyer1',
    name: 'Örnek Avukat Bir',
    platformRole: 'user',
    status: 'verified',
    registry: { kind: 'sicil', no: 'ORNEK-1004' },
  },
  {
    key: 'lawyer2',
    name: 'Örnek Avukat İki',
    platformRole: 'user',
    status: 'verified',
    registry: { kind: 'sicil', no: 'ORNEK-1005' },
  },
  {
    key: 'trainee',
    name: 'Örnek Stajyer Avukat',
    platformRole: 'user',
    status: 'verified',
    registry: { kind: 'trainee', no: 'ORNEK-S2001' },
  },
  { key: 'assistant', name: 'Örnek Büro Asistanı', platformRole: 'user', status: 'verified' },
  {
    key: 'solo',
    name: 'Örnek Bireysel Avukat',
    platformRole: 'user',
    status: 'verified',
    registry: { kind: 'sicil', no: 'ORNEK-1006' },
  },
  {
    key: 'pending',
    name: 'Örnek Başvuru Sahibi',
    platformRole: 'user',
    status: 'pending_verification',
    registry: { kind: 'sicil', no: 'ORNEK-1007' },
  },
  {
    key: 'platform_admin',
    name: 'Örnek Platform Yöneticisi',
    platformRole: 'super_admin',
    status: 'verified',
  },
  {
    key: 'platform_support',
    name: 'Örnek Platform Destek',
    platformRole: 'support',
    status: 'verified',
  },
];

interface SampleOrg {
  readonly key: string;
  readonly name: string;
  readonly slug: string;
  readonly kind: 'firm' | 'individual';
  readonly partnerCode: string | null;
  readonly members: readonly (readonly [string, Role])[];
}

export const SAMPLE_ORGS: readonly SampleOrg[] = [
  {
    key: 'firm',
    name: 'Örnek Hukuk Bürosu',
    slug: 'ornek-hukuk-burosu',
    kind: 'firm',
    partnerCode: PARTNER_CODE,
    members: [
      ['owner', 'owner'],
      ['admin', 'admin'],
      ['senior_lawyer', 'senior_lawyer'],
      ['lawyer1', 'lawyer'],
      ['lawyer2', 'lawyer'],
      ['trainee', 'trainee'],
      ['assistant', 'assistant'],
    ],
  },
  {
    key: 'solo',
    name: 'Örnek Bireysel Büro',
    slug: 'ornek-bireysel-buro',
    kind: 'individual',
    partnerCode: null,
    members: [['solo', 'owner']],
  },
  {
    key: 'pending',
    name: 'Örnek Başvuru Bürosu',
    slug: 'ornek-basvuru-burosu',
    kind: 'individual',
    partnerCode: null,
    members: [['pending', 'owner']],
  },
];

const userId = (key: string) => seedId(`dev-sample:user:${key}`);
const orgId = (key: string) => seedId(`dev-sample:org:${key}`);
export const sampleUserId = userId;
export const sampleOrgId = orgId;
export const sampleEmail = (key: string) => `${key}@${DEV_SAMPLE_DOMAIN}`;

export interface DevSampleSecrets {
  /** `DEV_SEED_PASSWORD_FILE` yolu (migrate env). */
  readonly passwordFile?: string | undefined;
  /** `KEK_MASTER_FILE` yolu (migrate env). */
  readonly kekFile?: string | undefined;
}

function readSecret(path: string | undefined, name: string): string {
  if (path === undefined || path === '') {
    throw new MigrateError(EXIT.seed, `${name} tanımsız; make secrets ile dev sırlarını üretin`);
  }
  try {
    const v = readFileSync(path, 'utf8');
    if (v.trim() === '') throw new Error('boş');
    return v;
  } catch {
    throw new MigrateError(EXIT.seed, `${name} okunamadı; make secrets ile dev sırlarını üretin`);
  }
}

async function argon2id(password: string): Promise<string> {
  // Yerel modül yalnız bu aşamada yüklenir (prod profili bu kod yolunu çağırmaz).
  const { hash } = await import('@node-rs/argon2');
  return hash(password, {
    algorithm: 2,
    memoryCost: CONFIG_DEFAULTS['auth.argon2MemoryKiB'],
    timeCost: CONFIG_DEFAULTS['auth.argon2TimeCost'],
    parallelism: CONFIG_DEFAULTS['auth.argon2Parallelism'],
  });
}

const add = (c: SeedCounts, n: number | null) => {
  if ((n ?? 0) > 0) c.inserted += n ?? 0;
  else c.skipped += 1;
};

async function apply(q: ClientBase, secrets: DevSampleSecrets): Promise<SeedCounts> {
  const counts = emptyCounts();
  const password = readSecret(secrets.passwordFile, 'DEV_SEED_PASSWORD_FILE').trim();
  const kek = parseKekFile(readSecret(secrets.kekFile, 'KEK_MASTER_FILE'));
  const pwHash = await argon2id(password);

  // ---- bayi ve kupon (katalog; RLS yok) ----
  const partner = await q.query<{ id: string }>(
    `INSERT INTO app.partners (id, code, name) VALUES ($1, $2, 'Örnek Bayi')
     ON CONFLICT (code) DO NOTHING RETURNING id`,
    [seedId('dev-sample:partner'), PARTNER_CODE],
  );
  add(counts, partner.rowCount);
  const coupon = await q.query(
    `INSERT INTO app.coupons (id, code, description, discount_type, percent_off, partner_id,
       valid_during)
     VALUES ($1, $2, 'Örnek veri kuponu', 'percent', $3,
       (SELECT id FROM app.partners WHERE code = $4), tstzrange('2026-01-01', NULL))
     ON CONFLICT (code) DO NOTHING`,
    [seedId('dev-sample:coupon'), COUPON_CODE, SAMPLE_COUPON_PERCENT, PARTNER_CODE],
  );
  add(counts, coupon.rowCount);

  // ---- kullanıcılar ve parola hesapları (auth; RLS yok) ----
  for (const u of SAMPLE_USERS) {
    const id = userId(u.key);
    const r = await q.query(
      `INSERT INTO auth.users (id, name, email, email_verified, platform_role, verification_status)
       VALUES ($1, $2, $3, true, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [id, u.name, sampleEmail(u.key), u.platformRole, u.status],
    );
    add(counts, r.rowCount);
    if (u.platformRole !== 'user') continue;
    const a = await q.query(
      `INSERT INTO auth.accounts (user_id, account_id, provider_id, password)
       VALUES ($1, $2, 'credential', $3) ON CONFLICT (provider_id, account_id) DO NOTHING`,
      [id, id, pwHash],
    );
    add(counts, a.rowCount);
  }

  // ---- bürolar, abonelik (koltuk tetikleyicisinden önce), üyelikler ----
  for (const o of SAMPLE_ORGS) {
    const id = orgId(o.key);
    const r = await q.query(
      `INSERT INTO auth.organizations (id, name, slug, kind, partner_code, metadata)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [id, o.name, o.slug, o.kind, o.partnerCode, SAMPLE_METADATA],
    );
    add(counts, r.rowCount);
    if (o.kind === 'firm') {
      const sub = await withSeedRlsException(q, 'subscriptions', () =>
        q.query(
          `INSERT INTO app.subscriptions (id, org_id, plan_code, status, provider, seats,
             trial_ends_at, current_period_start, current_period_end)
           SELECT $1, $2, 'firm', 'trialing', 'manual', $3, now() + make_interval(days => $4),
             now(), now() + make_interval(days => $4)
           WHERE NOT EXISTS (SELECT 1 FROM app.subscriptions s WHERE s.org_id = $2
             AND s.status IN ('trialing', 'active', 'past_due'))`,
          [
            seedId(`dev-sample:subscription:${o.key}`),
            id,
            SAMPLE_FIRM_SEATS,
            CONFIG_DEFAULTS['trial.days'],
          ],
        ),
      );
      add(counts, sub.rowCount);
    }
    for (const [key, role] of o.members) {
      // BEFORE INSERT koltuk tetikleyicisi çakışma denetiminden önce çalışır: varlık denetimiyle.
      const m = await q.query(
        `INSERT INTO auth.members (organization_id, user_id, role, status)
         SELECT $1, $2, $3, 'active'
         WHERE NOT EXISTS (SELECT 1 FROM auth.members WHERE organization_id = $1 AND user_id = $2)`,
        [id, userId(key), role],
      );
      add(counts, m.rowCount);
    }
  }

  // ---- büro ayarları, anahtarlar ve kredi (sentetik sahip bağıyla) ----
  for (const o of SAMPLE_ORGS) {
    const id = orgId(o.key);
    const ownerId = userId(o.members[0]?.[0] ?? '');
    await bindSeedContext(q, { orgId: id, userId: ownerId });
    const s = await q.query(
      `INSERT INTO app.org_settings (org_id, trainee_supervision) VALUES ($1, $2)
       ON CONFLICT (org_id) DO NOTHING`,
      [id, o.kind === 'firm'],
    );
    add(counts, s.rowCount);
    const has = await q.query('SELECT 1 FROM app.org_keys WHERE org_id = $1 AND key_version = 1', [
      id,
    ]);
    if (has.rowCount === 0) {
      const dek = randomBytes(32);
      try {
        const wrapped = wrapDek(
          kek.kek,
          { orgId: id, dekVersion: 1, kekVersion: kek.kekVersion },
          dek,
        );
        const k = await q.query(
          `INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version)
           VALUES ($1, 1, $2, $3)`,
          [id, wrapped, kek.kekVersion],
        );
        add(counts, k.rowCount);
      } finally {
        wipe(dek);
      }
    } else {
      counts.skipped += 1;
    }
    if (o.kind === 'firm') {
      const credit = await withSeedRlsException(q, 'credit_ledger', async () => {
        await q.query("SELECT pg_advisory_xact_lock(hashtextextended('credit:' || $1, 0))", [id]);
        return q.query(
          `INSERT INTO app.credit_ledger (org_id, entry_type, amount, balance_after, user_id,
             subscription_id, expires_at, created_by)
           SELECT $1, 'trial_grant', $2, $2, $3, s.id, s.trial_ends_at, $3
           FROM app.subscriptions s
           WHERE s.org_id = $1 AND s.status = 'trialing'
             AND NOT EXISTS (SELECT 1 FROM app.credit_ledger c WHERE c.org_id = $1
               AND c.entry_type = 'trial_grant')`,
          [id, CONFIG_DEFAULTS['trial.credits'], ownerId],
        );
      });
      add(counts, credit.rowCount);
    }
  }

  // ---- meslek profilleri (kullanıcı bağıyla; `lawyer_profiles` RLS) ----
  const reviewer = userId('platform_admin');
  for (const u of SAMPLE_USERS) {
    if (u.registry === undefined) continue;
    const id = userId(u.key);
    await bindSeedContext(q, { userId: id });
    const reviewed = u.status === 'verified';
    const p = await q.query(
      `INSERT INTO app.lawyer_profiles (user_id, baro, sicil_no, trainee_registry_no,
         verification_source, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() END)
       ON CONFLICT (user_id) DO NOTHING`,
      [
        id,
        SAMPLE_BARO,
        u.registry.kind === 'sicil' ? u.registry.no : null,
        u.registry.kind === 'trainee' ? u.registry.no : null,
        reviewed ? 'admin_review' : null,
        reviewed ? reviewer : null,
        reviewed,
      ],
    );
    add(counts, p.rowCount);
  }
  return counts;
}

export function devSampleIdentitySeed(secrets: DevSampleSecrets = {}): SeedDef {
  return {
    name: 'dev-sample-identity',
    stage: 'dev-sample',
    // İçerik özeti yalnız yapıdır (parola ve anahtar değeri girmez).
    content: {
      v: 1,
      users: SAMPLE_USERS,
      orgs: SAMPLE_ORGS,
      partner: PARTNER_CODE,
      coupon: [COUPON_CODE, SAMPLE_COUPON_PERCENT],
      seats: SAMPLE_FIRM_SEATS,
      baro: SAMPLE_BARO,
    },
    apply: (q) => apply(q, secrets),
  };
}
