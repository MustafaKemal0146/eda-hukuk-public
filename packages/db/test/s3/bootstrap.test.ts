// @tk TK-06
// KK-P20-5 (KK-033-20): S3 bootstrap: kova + yaşam döngüsü + Object Lock, idempotentlik, config'ten
// üretilen süre, yeniden deneme ve desteklenmeyen özelliğin sessizce atlanmaması.
import { describe, expect, it } from 'vitest';
import { s3Bootstrap } from '../../src/migrate/index.ts';
import type { LogEntry } from '../../src/migrate/log.ts';
import { runS3Bootstrap } from '../../src/s3/bootstrap.ts';

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };
const cfg = {
  buckets: { files: 'eda-files', exports: 'eda-exports', audit: 'eda-audit-seals' },
  exportsDays: 7,
  auditLockYears: 5,
};

function inputOf(calls: Cmd[], name: string, bucket: string): Record<string, unknown> {
  const c = calls.find((x) => x.constructor.name === name && x.input.Bucket === bucket);
  if (c === undefined) throw new Error(`${name} çağrısı yok: ${bucket}`);
  return c.input;
}

const err = (name: string, status?: number): Error =>
  Object.assign(new Error(name), {
    name,
    ...(status === undefined ? {} : { $metadata: { httpStatusCode: status } }),
  });

function fake(existing: Set<string>, over: (cmd: Cmd) => unknown = () => ({})) {
  const calls: Cmd[] = [];
  return {
    calls,
    client: {
      send: async (cmd: Cmd) => {
        calls.push(cmd);
        const n = cmd.constructor.name;
        if (n === 'HeadBucketCommand') {
          if (!existing.has(String(cmd.input.Bucket))) throw err('NotFound', 404);
          return {};
        }
        if (n === 'CreateBucketCommand') existing.add(String(cmd.input.Bucket));
        return over(cmd);
      },
    },
  };
}

describe('KK-P20-5: S3 bootstrap', () => {
  it('boş depoda üç kova + kurallar; ikinci koşuda kova oluşturulmaz (no-op)', async () => {
    const existing = new Set<string>();
    const f = fake(existing);
    const first = await runS3Bootstrap(f.client, cfg);
    expect(first.created).toEqual(['eda-files', 'eda-exports', 'eda-audit-seals']);
    expect(first.unsupported).toEqual([]);
    const create = f.calls.filter((c) => c.constructor.name === 'CreateBucketCommand');
    expect(
      create.find((c) => c.input.Bucket === 'eda-audit-seals')?.input.ObjectLockEnabledForBucket,
    ).toBe(true);
    expect(
      create.find((c) => c.input.Bucket === 'eda-files')?.input.ObjectLockEnabledForBucket,
    ).toBeUndefined();
    const second = fake(existing);
    const again = await runS3Bootstrap(second.client, cfg);
    expect(again.created).toEqual([]);
    expect(second.calls.some((c) => c.constructor.name === 'CreateBucketCommand')).toBe(false);
  });

  it('yaşam döngüsü kuralları: süre config’ten, files sürümsüz, audit COMPLIANCE', async () => {
    const f = fake(new Set());
    await runS3Bootstrap(f.client, { ...cfg, exportsDays: 9 });
    const rulesOf = (bucket: string) =>
      (
        inputOf(f.calls, 'PutBucketLifecycleConfigurationCommand', bucket)
          .LifecycleConfiguration as { Rules: { ID: string; Expiration?: { Days: number } }[] }
      ).Rules;
    expect(rulesOf('eda-files').map((r) => r.ID)).toEqual(['abort-incomplete-mpu']);
    expect(rulesOf('eda-exports').find((r) => r.ID === 'expire-exports')?.Expiration?.Days).toBe(9);
    const lock = f.calls.find((c) => c.constructor.name === 'PutObjectLockConfigurationCommand');
    expect(lock?.input.Bucket).toBe('eda-audit-seals');
    expect(JSON.stringify(lock?.input.ObjectLockConfiguration)).toContain('COMPLIANCE');
    expect(f.calls.some((c) => c.constructor.name === 'PutBucketVersioningCommand')).toBe(false);
  });

  it('desteklenmeyen özellik sessizce atlanmaz: rapora ve günlüğe yazılır', async () => {
    const f = fake(new Set(), (cmd) => {
      if (cmd.constructor.name === 'PutObjectLockConfigurationCommand')
        throw err('NotImplemented', 501);
      return {};
    });
    const logs: string[] = [];
    const r = await runS3Bootstrap(f.client, cfg, { log: (e) => logs.push(e) });
    expect(r.unsupported).toEqual([{ bucket: 'eda-audit-seals', feature: 'object_lock' }]);
    expect(logs).toContain('s3.bootstrap.unsupported');
  });

  it('geçici hata yeniden denenir; kalıcı hata fırlatılır', async () => {
    let n = 0;
    const flaky = fake(new Set(), () => {
      n += 1;
      if (n === 1) throw err('InternalError', 503);
      return {};
    });
    const slept: number[] = [];
    await expect(
      runS3Bootstrap(flaky.client, cfg, {
        attempts: 3,
        delayMs: 10,
        sleep: async (ms) => void slept.push(ms),
      }),
    ).resolves.toBeDefined();
    expect(slept.length).toBe(1);
    const denied = fake(new Set(), () => {
      throw err('AccessDenied', 403);
    });
    await expect(
      runS3Bootstrap(denied.client, cfg, { attempts: 3, sleep: async () => undefined }),
    ).rejects.toThrow();
  });

  it('migrate adımı: yapılandırma yoksa atlanır; üretimde hata çıkış 51, geliştirmede uyarı', async () => {
    const entries: LogEntry[] = [];
    const log = { write: (e: LogEntry) => void entries.push(e) };
    await s3Bootstrap(log);
    expect(entries.at(-1)?.event).toBe('s3.bootstrap.skipped');
    const down = {
      send: async () => {
        throw err('Unavailable', 503);
      },
    };
    const s3 = { client: down, config: cfg };
    await expect(s3Bootstrap(log, s3, 'production', async () => undefined)).rejects.toMatchObject({
      code: 51,
    });
    await expect(s3Bootstrap(log, s3, 'test')).resolves.toBeUndefined();
    expect(entries.some((e) => e.event === 's3.bootstrap.failed' && e.level === 'warn')).toBe(true);
  });
});
