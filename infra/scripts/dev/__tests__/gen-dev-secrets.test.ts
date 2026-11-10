// @tk TK-28
// KK-P01a-2 / KK-070-14: make secrets dosya kümesi, biçimler, idempotentlik. Sır değeri yazdırılmaz.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

const SCRIPT = join(import.meta.dirname, '..', 'gen-dev-secrets.sh');
const dir = join(mkdtempSync(join(tmpdir(), 'eda-sir-')), 'dev');
const run = (env: Record<string, string> = {}): string => {
  const r = spawnSync('bash', [SCRIPT, dir], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, 'betik başarısız');
  return r.stdout;
};
const read = (name: string): string => readFileSync(join(dir, name), 'utf8');

const B64URL32 = /^[A-Za-z0-9_-]{43}$/;
const PROVIDERS = [
  'deepseek_api_key',
  'anthropic_api_key',
  'anthropic_eu_api_key',
  'azure_eu_api_key',
  'vertex_credentials',
  'local_llm_api_key',
  'google_client_secret',
  'email_api_key',
  'iyzico_api_key',
  'iyzico_secret_key',
  'backup_s3_access_key_id',
  'backup_s3_secret_access_key',
  'acme_dns_api_token',
];

describe('KK-P01a-2: gen-dev-secrets.sh', () => {
  let first = '';
  before(() => {
    first = run();
  });
  after(() => rmSync(join(dir, '..'), { recursive: true, force: true }));

  it('51 sır + dev_seed_password + derived.env üretir', () => {
    assert.equal(readdirSync(dir).length, 53);
    assert.match(first, /53 üretildi, 0 korundu/);
  });

  it('dizin 0700, dosyalar 0644', () => {
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    for (const f of readdirSync(dir)) assert.equal(statSync(join(dir, f)).mode & 0o777, 0o644, f);
  });

  it('biçimler: base64url, base64, PEM, S3 uzunlukları, boş sağlayıcılar', () => {
    for (const n of [
      'pg_app_password',
      'valkey_api_password',
      'doc_engine_token',
      'dev_seed_password',
    ]) {
      assert.match(read(n), B64URL32, n);
    }
    // 033 §4.1: ilk satır `v<sürüm>:<base64>` (KK-P03c-15 ayrıştırıcısı bu biçimi ister).
    const [version, key = ''] = read('kek_master').split(':');
    assert.equal(version, 'v1');
    assert.equal(Buffer.from(key, 'base64').length, 32);
    assert.equal(Buffer.from(read('restic_password'), 'base64').length, 48);
    assert.match(read('internal_jwt_private_key'), /^-----BEGIN PRIVATE KEY-----/);
    assert.match(read('internal_jwt_public_key'), /^-----BEGIN PUBLIC KEY-----/);
    assert.match(read('pgbackrest_ca_crt'), /^-----BEGIN CERTIFICATE-----/);
    for (const p of ['s3', 's3_audit', 's3_admin']) {
      assert.match(read(`${p}_access_key_id`), /^[A-Z0-9]{20}$/);
      assert.match(read(`${p}_secret_access_key`), /^[A-Za-z0-9]{40}$/);
    }
    assert.notEqual(read('s3_access_key_id'), read('s3_admin_access_key_id'));
    assert.match(read('vapid_private_key'), B64URL32);
    assert.match(read('derived.env'), /^VAPID_PUBLIC_KEY=[A-Za-z0-9_-]{87}$/m);
    for (const p of PROVIDERS) assert.equal(read(p), '', p);
  });

  it('pg sertifikası SAN DNS:postgres taşır ve CA ile doğrulanır', () => {
    const r = spawnSync(
      'openssl',
      ['verify', '-CAfile', join(dir, 'pgbackrest_ca_crt'), join(dir, 'pgbackrest_pg_crt')],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 0);
    const san = spawnSync(
      'openssl',
      ['x509', '-in', join(dir, 'pgbackrest_pg_crt'), '-noout', '-ext', 'subjectAltName'],
      { encoding: 'utf8' },
    );
    assert.match(san.stdout, /DNS:postgres/);
  });

  it('ikinci koşu hiçbir dosyayı değiştirmez', () => {
    const before = readdirSync(dir)
      .map((f) => read(f))
      .join('\0');
    assert.match(run(), / 0 üretildi/);
    assert.equal(
      readdirSync(dir)
        .map((f) => read(f))
        .join('\0'),
      before,
    );
  });

  it('FORCE=1 üretilenleri yeniler, elle doldurulan sağlayıcı anahtarına dokunmaz', () => {
    const old = read('pg_app_password');
    spawnSync('bash', ['-c', `printf 'elle' > '${join(dir, 'deepseek_api_key')}'`]);
    run({ FORCE: '1' });
    assert.notEqual(read('pg_app_password'), old);
    assert.equal(read('deepseek_api_key'), 'elle');
  });

  it('çıktı sır değeri içermez', () => {
    const out = run();
    assert.ok(!out.includes(read('pg_app_password')));
  });
});
