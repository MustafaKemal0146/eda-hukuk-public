// @tk TK-29
// KK-P03c-11 (KK-032-14): seed profil kapısı. `dev` profili yalnız development/test; production,
// staging, beta-synthetic, onprem için çıkış 60 (bin/seed.ts env doğrulamasından ve DB bağlantısından
// önce). `test` ortamında dev-sample aşaması çalışmaz.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/migrate/exit-codes.ts';
import { defaultSeeds, seedsFor } from '../../src/seed/index.ts';
import { devStagesFor, parseProfile, profileGateViolated } from '../../src/seed/profile.ts';

const SEED_BIN = fileURLToPath(new URL('../../src/bin/seed.ts', import.meta.url));

describe('KK-P03c-11 (KK-032-14): seed profil kapısı', () => {
  it('dev profili development/test dışında ihlaldir; prod profili her ortamda serbest', () => {
    for (const env of ['production', 'staging', 'beta-synthetic', 'onprem']) {
      expect(profileGateViolated('dev', env), env).toBe(true);
      expect(profileGateViolated('prod', env), env).toBe(false);
    }
    for (const env of ['development', 'test']) expect(profileGateViolated('dev', env)).toBe(false);
  });

  it('test ortamında dev-sample yok; development ortamında var; prod profilinde dev aşaması yok', () => {
    expect(devStagesFor('dev', 'test')).toEqual(['dev-base', 'dev-fixture-rules']);
    expect(devStagesFor('dev', 'development')).toEqual([
      'dev-base',
      'dev-fixture-rules',
      'dev-sample',
    ]);
    expect(devStagesFor('prod', 'development')).toEqual([]);
    const prodNames = seedsFor('prod', 'production').map((s) => s.name);
    expect(prodNames).not.toContain('dev-base');
    expect(prodNames).not.toContain('dev-fixture-rules');
    expect(seedsFor('dev', 'test').map((s) => s.name)).toEqual(
      defaultSeeds()
        .filter((s) => s.stage !== 'dev-sample')
        .map((s) => s.name),
    );
  });

  it('varsayılan profil: development/test dev, diğerleri prod; geçersiz profil hata', () => {
    expect(parseProfile(undefined, 'test')).toBe('dev');
    expect(parseProfile(undefined, 'production')).toBe('prod');
    expect(() => parseProfile('ornek', 'test')).toThrow(/geçersiz seed profili/);
  });

  it('bin/seed.ts: EDA_ENV=production + SEED_PROFILE=dev ve staging/beta-synthetic/onprem çıkış 60', () => {
    for (const env of ['production', 'staging', 'beta-synthetic', 'onprem']) {
      const r = spawnSync(process.execPath, [SEED_BIN], {
        env: { EDA_ENV: env, SEED_PROFILE: 'dev' },
        encoding: 'utf8',
      });
      expect(r.status, `${env}: ${r.stderr}`).toBe(EXIT.profileGate);
      expect(r.stdout).toContain('"event":"profile.gate"');
    }
  });
});
