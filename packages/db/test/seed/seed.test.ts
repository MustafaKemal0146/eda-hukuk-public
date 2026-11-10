// @tk TK-29
// Seed (032 §10–§12): TEST yığınında migrate `prod` profiliyle koşar (test-db.sh). Bu dosya önce prod
// sayımlarını doğrular, sonra idempotentlik, --force bayt eşitliği, doğrulanmış kural koruması,
// tatil verisi, sağlayıcı CHECK'leri ve canon-seed.json eşitliğini sınar; en sonda dev profilini
// (dev-base, dev-fixture-rules) uygular. Testler sıralıdır (aynı dosya, tek bağlantı).
import { readFileSync } from 'node:fs';
import { DEADLINE_RULE_CATALOG } from '@eda/legal/deadline-engine';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, type LogEntry, MigrateError } from '../../src/migrate/index.ts';
import { defaultSeeds, runSeed, seedsFor } from '../../src/seed/index.ts';
import { deadlineRulesSeed } from '../../src/seed/prod/catalogs.ts';
import { ownerDb, sqlError } from '../fixtures/db.ts';

let owner: pg.Client;
const logs: LogEntry[] = [];
const log = { write: (e: LogEntry) => void logs.push(e) };

beforeAll(async () => {
  owner = await ownerDb();
});
afterAll(async () => {
  await owner.end();
});

const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await owner.query<{ n: string }>(sql, params)).rows[0]?.n);

/** Seed'in dokunduğu tabloların içerik özeti (bayt eşitliği; KK-032-11). */
async function dump(): Promise<string> {
  const r = await owner.query<{ h: string }>(
    `SELECT md5(string_agg(t, '|' ORDER BY t)) AS h FROM (
       SELECT 'p' || p::text AS t FROM app.plans p
       UNION ALL SELECT 'f' || f::text FROM app.feature_flags f
       UNION ALL SELECT 's' || s::text FROM corpus.source_status s
       UNION ALL SELECT 'c' || c::text FROM app.case_types c
       UNION ALL SELECT 'h' || h::text FROM app.holidays h
       UNION ALL SELECT 'j' || j::text FROM app.judicial_recesses j
       UNION ALL SELECT 'd' || d::text FROM app.deadline_rules d
       UNION ALL SELECT 'a' || a::text FROM app.ai_providers a
       UNION ALL SELECT 'm' || m::text FROM app.ai_models m
       UNION ALL SELECT 'r' || r::text FROM app.ai_task_routes r) x`,
  );
  return r.rows[0]?.h ?? '';
}

describe('KK-P03c-7 (KK-032-10 uyarlanmış): prod profiliyle migrate sonrası sayımlar', () => {
  it('katalog ve referans sayımları; mock, dev_fixture, örnek büro, courts/chambers/şablon 0', async () => {
    const got = {
      ai_providers: await count('SELECT count(*) AS n FROM app.ai_providers'),
      ai_models: await count('SELECT count(*) AS n FROM app.ai_models'),
      ai_task_routes: await count('SELECT count(*) AS n FROM app.ai_task_routes'),
      plans: await count('SELECT count(*) AS n FROM app.plans'),
      holidays: await count('SELECT count(*) AS n FROM app.holidays'),
      judicial_recesses: await count('SELECT count(*) AS n FROM app.judicial_recesses'),
      deadline_rules: await count('SELECT count(*) AS n FROM app.deadline_rules'),
      deadline_rules_verified: await count(
        'SELECT count(*) AS n FROM app.deadline_rules WHERE verified_at IS NOT NULL',
      ),
      case_types: await count('SELECT count(*) AS n FROM app.case_types'),
      feature_flags: await count('SELECT count(*) AS n FROM app.feature_flags'),
      source_status: await count('SELECT count(*) AS n FROM corpus.source_status'),
      source_live: await count('SELECT count(*) AS n FROM corpus.source_status WHERE live_enabled'),
      system_settings: await count('SELECT count(*) AS n FROM app.system_settings'),
      mock: await count("SELECT count(*) AS n FROM app.ai_providers WHERE kind = 'mock'"),
      dev_fixture: await count(
        "SELECT count(*) AS n FROM app.deadline_rules WHERE code LIKE 'dev\\_fixture\\_%'",
      ),
      sample_org: await count(
        `SELECT count(*) AS n FROM auth.organizations WHERE metadata LIKE '%"sampleData":true%'`,
      ),
      courts: await count('SELECT count(*) AS n FROM app.courts'),
      chambers: await count('SELECT count(*) AS n FROM app.chambers'),
      // Test dünyalarının şablonları "Örnek veri" başlıklıdır; seed şablonu (P18) yoktur.
      platform_templates: await count(
        "SELECT count(*) AS n FROM app.templates WHERE org_id IS NULL AND title NOT LIKE 'Örnek veri%'",
      ),
    };
    expect(got).toEqual({
      ai_providers: 4,
      ai_models: 3,
      ai_task_routes: 10,
      plans: 6,
      holidays: 51,
      judicial_recesses: 9,
      deadline_rules: 27,
      deadline_rules_verified: 0,
      case_types: 39,
      feature_flags: 2,
      source_status: 14,
      source_live: 4,
      system_settings: 0,
      mock: 0,
      dev_fixture: 0,
      sample_org: 0,
      courts: 0,
      chambers: 0,
      platform_templates: 0,
    });
  });
});

describe('KK-P03c-8 (KK-032-11): seed idempotentliği', () => {
  it('ikinci koşuda tüm seed adımları skipped; --force tablo içeriğini bayt düzeyinde değiştirmez', async () => {
    const before = await dump();
    const second = await runSeed({ client: owner, profile: 'prod', edaEnv: 'test', log });
    expect(second.map((o) => o.status)).toEqual(second.map(() => 'skipped'));
    expect(second.map((o) => o.name)).toEqual(seedsFor('prod', 'test').map((s) => s.name));
    const forced = await runSeed({
      client: owner,
      profile: 'prod',
      edaEnv: 'test',
      log,
      force: true,
    });
    expect(forced.every((o) => o.status === 'applied' && o.inserted === 0 && o.updated === 0)).toBe(
      true,
    );
    expect(await dump()).toBe(before);
  });

  it('--dry-run işlemi geri alır ve seed_runs yazmaz', async () => {
    const runs = await count('SELECT count(*) AS n FROM public.seed_runs');
    const dry = await runSeed({
      client: owner,
      profile: 'prod',
      edaEnv: 'test',
      log,
      dryRun: true,
    });
    expect(dry.every((o) => o.status === 'dry_run')).toBe(true);
    expect(await count('SELECT count(*) AS n FROM public.seed_runs')).toBe(runs);
  });
});

describe('KK-P03c-9 (KK-032-12): doğrulanmış süre kuralı ezilmez', () => {
  it('doğrulanmış satırın taslağı değişirse çıkış 41 ve satır değişmez; doğrulanmamış satır güncellenir', async () => {
    const [verified, open] = ['hmk_cevap_dilekcesi', 'hmk_replik_dilekcesi'];
    await owner.query(
      `UPDATE app.deadline_rules SET verified_by = 'Örnek veri doğrulayıcı', verified_at = now()
       WHERE code = $1 AND version = 1`,
      [verified],
    );
    const titleOf = async (code: string) =>
      (
        await owner.query<{ title: string }>(
          'SELECT title FROM app.deadline_rules WHERE code = $1 AND version = 1',
          [code],
        )
      ).rows[0]?.title;
    const verifiedTitle = await titleOf(verified);
    const changed = DEADLINE_RULE_CATALOG.map((r) =>
      r.code === verified ? { ...r, title: `${r.title} (değişti)` } : r,
    );
    const err = await runSeed({
      client: owner,
      profile: 'prod',
      edaEnv: 'test',
      log,
      seeds: [deadlineRulesSeed(changed)],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrateError);
    expect((err as MigrateError).code).toBe(EXIT.seedVerify);
    expect(await titleOf(verified)).toBe(verifiedTitle);

    const openChanged = DEADLINE_RULE_CATALOG.map((r) =>
      r.code === open ? { ...r, title: `${r.title} (taslak değişti)` } : r,
    );
    const ok = await runSeed({
      client: owner,
      profile: 'prod',
      edaEnv: 'test',
      log,
      seeds: [deadlineRulesSeed(openChanged)],
    });
    expect(ok[0]).toMatchObject({ status: 'applied', updated: 1, inserted: 0 });
    expect(await titleOf(open)).toMatch(/taslak değişti\)$/);
    // Varsayılan taslağa dönüş (yalnız doğrulanmamış satır değişir).
    const back = await runSeed({
      client: owner,
      profile: 'prod',
      edaEnv: 'test',
      log,
      force: true,
    });
    expect(back.find((o) => o.name === 'deadline_rules')).toMatchObject({ updated: 1 });
  });
});

describe('KK-P03c-10 (KK-032-13): tatil ve adli tatil verisi', () => {
  it('yıl başına 17 satır; arife ve 28 Ekim yarım gün 13:00; 2027-05-19 iki satır; adli tatil aralıkları', async () => {
    const perYear = await owner.query<{ y: number; n: string }>(
      `SELECT extract(year FROM holiday_date)::int AS y, count(*) AS n FROM app.holidays
       GROUP BY 1 ORDER BY 1`,
    );
    expect(perYear.rows.map((r) => [r.y, Number(r.n)])).toEqual([
      [2026, 17],
      [2027, 17],
      [2028, 17],
    ]);
    const half = await owner.query<{ code: string; t: string }>(
      `SELECT DISTINCT code, starts_at_local::text AS t FROM app.holidays WHERE is_half_day ORDER BY 1`,
    );
    expect(half.rows).toEqual([
      { code: 'kurban_bayrami_arife', t: '13:00:00' },
      { code: 'ramazan_bayrami_arife', t: '13:00:00' },
      { code: 'republic_day_eve', t: '13:00:00' },
    ]);
    const same = await owner.query<{ code: string }>(
      "SELECT code FROM app.holidays WHERE holiday_date = '2027-05-19' ORDER BY code",
    );
    expect(same.rows.map((r) => r.code)).toEqual(['kurban_bayrami_4', 'youth_sports_day']);
    const rec = await owner.query<{ branch: string; year: number; period: string }>(
      'SELECT branch, year, period::text AS period FROM app.judicial_recesses ORDER BY branch, year',
    );
    expect(rec.rows).toHaveLength(9);
    for (const r of rec.rows) expect(r.period).toBe(`[${r.year}-07-20,${r.year}-09-01)`);
    expect(new Set(rec.rows.map((r) => r.branch))).toEqual(new Set(['hmk', 'cmk', 'iyuk']));
  });
});

describe('KK-P03c-13 (KK-032-16 öncülü): sağlayıcı CHECKleri ve canon-seed.json eşitliği', () => {
  it('koşullar sağlanmadan client/case izni CHECK ihlali verir', async () => {
    await owner.query('BEGIN');
    try {
      expect(
        await sqlError(
          owner,
          "UPDATE app.ai_providers SET allowed_data_classes = '{public,client}' WHERE id = 'deepseek'",
        ),
      ).toEqual({ code: '23514', constraint: 'ai_providers_class_basis_chk' });
      expect(
        await sqlError(
          owner,
          `UPDATE app.ai_providers SET transfer_basis = 'scc_notified', scc_notified_at = now(),
             allowed_data_classes = '{public,case}' WHERE id = 'azure-eu'`,
        ),
      ).toEqual({ code: '23514', constraint: 'ai_providers_class_terms_chk' });
    } finally {
      await owner.query('ROLLBACK');
    }
  });

  it('canon-seed.json (002 §12, 032 §10.2, §10.6) <-> DB eşit', async () => {
    const canon = JSON.parse(
      readFileSync(new URL('../fixtures/canon-seed.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown[]>;
    const providers = await owner.query(
      `SELECT id, kind, region, transfer_basis, allowed_data_classes, secret_ref, training_use,
              human_review, retention_days, enabled, priority
       FROM app.ai_providers WHERE kind <> 'mock' ORDER BY priority`,
    );
    const models = await owner.query(
      `SELECT alias, provider_id, thinking, context_budget, max_output_tokens,
              cache_hit_offpeak_micro_usd_per_mtok::int AS cache_hit_offpeak,
              cache_hit_peak_micro_usd_per_mtok::int AS cache_hit_peak,
              input_offpeak_micro_usd_per_mtok::int AS input_offpeak,
              input_peak_micro_usd_per_mtok::int AS input_peak,
              output_offpeak_micro_usd_per_mtok::int AS output_offpeak,
              output_peak_micro_usd_per_mtok::int AS output_peak,
              (capabilities->>'tools')::boolean AS tools, enabled
       FROM app.ai_models WHERE provider_id <> 'mock' ORDER BY priority, alias`,
    );
    const routes = await owner.query(
      `SELECT task, alias_source, default_alias, thinking_override, tool_set, credit_op_code,
              max_output_tokens, enabled FROM app.ai_task_routes`,
    );
    const plans = await owner.query(
      `SELECT code, name, per_seat, seat_min, seat_max, monthly_credits, monthly_ocr_pages,
              storage_quota_bytes::float8 AS storage_quota_bytes,
              price_monthly_kurus::float8 AS price_monthly_kurus,
              price_yearly_kurus::float8 AS price_yearly_kurus, is_public, sort_order
       FROM app.plans ORDER BY sort_order`,
    );
    const byTask = (a: { task?: unknown }, b: { task?: unknown }) =>
      String(a.task).localeCompare(String(b.task));
    expect(providers.rows).toEqual(canon.providers);
    expect(models.rows).toEqual(canon.models);
    expect([...routes.rows].sort(byTask)).toEqual(
      [...(canon.routes as { task?: unknown }[])].sort(byTask),
    );
    expect(plans.rows).toEqual(canon.plans);
  });
});

describe('KK-P03c-11 (KK-032-14): dev profili test ortamında dev-sample çalıştırmaz', () => {
  it('dev profili: dev-base ve dev-fixture-rules uygulanır, dev-sample yoktur', async () => {
    const out = await runSeed({ client: owner, profile: 'dev', edaEnv: 'test', log });
    expect(out.map((o) => o.name)).not.toContain('dev-sample');
    expect(out.find((o) => o.name === 'dev-base')).toMatchObject({
      status: 'applied',
      inserted: 3,
    });
    expect(out.find((o) => o.name === 'dev-fixture-rules')).toMatchObject({ inserted: 1 });
    expect(await count("SELECT count(*) AS n FROM app.ai_models WHERE provider_id = 'mock'")).toBe(
      2,
    );
    expect(
      await count(
        "SELECT count(*) AS n FROM app.deadline_rules WHERE code = 'dev_fixture_14_day' AND verified_by = 'DEV-FIXTURE'",
      ),
    ).toBe(1);
    // Kayıt defterindeki her seed bu profilde koşar (prod seed'leri değişmediği için atlanır).
    expect(out.map((o) => o.name)).toEqual(
      defaultSeeds()
        .filter((s) => s.stage !== 'dev-sample')
        .map((s) => s.name),
    );
  });
});
