// @tk TK-28
//  platform ayarı sağlayıcısı (ağsız, veritabansız): çözümleme sırası (DB anahtarı > sır dosyası >
// yok), env sert kapısı, yumuşak anahtar, 30 sn önbellek/geçersiz kılma, yükleme hatasında eski değer,
// çözülemeyen kayıtta sır dosyasına düşüş ve sızıntı yok. Anahtarlar sentetiktir.
import { encryptField } from '@eda/crypto';
import { describe, expect, it } from 'vitest';
import { platformFallbackEnabled } from '../src/chat/platform-key.ts';
import {
  derivePlatformKey,
  orgKeyContext,
  platformKeyContext,
} from '../src/services/ai-keys/crypto.ts';
import {
  createPlatformSettings,
  PLATFORM_SETTINGS_TTL_MS,
  type PlatformSettingsRow,
} from '../src/services/ai-keys/platform-settings.ts';

const KEK = Buffer.alloc(32, 7);
const DB_KEY = `sk-ant-test-${'D'.repeat(30)}dbk1`;
const FILE_KEY = `sk-ant-test-${'F'.repeat(30)}file`;
const seal = (value: string, version = 1) =>
  encryptField(derivePlatformKey(KEK), platformKeyContext(version), value);

const row = (over: Partial<PlatformSettingsRow> = {}): PlatformSettingsRow => ({
  keyEnc: seal(DB_KEY),
  keyVersion: 1,
  keyLabel: 'Ortak Claude anahtarı',
  keyLast4: 'dbk1',
  fallbackEnabled: true,
  userTurnsPerDay: null,
  userTokensPerDay: null,
  orgDailyCapMicroUsd: null,
  platformDailyCapMicroUsd: null,
  ...over,
});

function make(opts: {
  envGate?: boolean;
  rows?: () => PlatformSettingsRow | Error;
  fileKey?: string | null;
}) {
  const clock = { t: 1_000_000 };
  const calls = { load: 0 };
  const events: string[] = [];
  const provider = createPlatformSettings({
    envGate: opts.envGate ?? true,
    load: async () => {
      calls.load += 1;
      const r = (opts.rows ?? (() => row()))();
      if (r instanceof Error) throw r;
      return r;
    },
    kek: KEK,
    readFileKey: () => (opts.fileKey === undefined ? FILE_KEY : opts.fileKey),
    now: () => clock.t,
    onEvent: (e) => events.push(e),
  });
  return { provider, clock, calls, events };
}

describe('AS-0409: platform ayarı çözümleme sırası', () => {
  it('DB anahtarı sır dosyasından önceliklidir; ad ve sınırlar anlık görüntüde', async () => {
    const { provider } = make({
      rows: () =>
        row({
          userTurnsPerDay: 75,
          userTokensPerDay: 500000,
          orgDailyCapMicroUsd: 4_000_000,
          platformDailyCapMicroUsd: 250_000_000,
        }),
    });
    expect(await provider.get()).toEqual({
      enabled: true,
      apiKey: DB_KEY,
      label: 'Ortak Claude anahtarı',
      source: 'panel',
      limits: {
        userTurnsPerDay: 75,
        userTokensPerDay: 500000,
        orgDailyCapMicroUsd: 4_000_000,
        platformDailyCapMicroUsd: 250_000_000,
      },
    });
  });

  it('DB anahtarı yoksa sunucu sır dosyası (ad yok); ikisi de yoksa anahtar yok', async () => {
    const none = row({ keyEnc: null, keyVersion: null, keyLabel: null, keyLast4: null });
    expect(await make({ rows: () => none }).provider.get()).toMatchObject({
      enabled: true,
      apiKey: FILE_KEY,
      label: null,
      source: 'server_secret',
    });
    expect(await make({ rows: () => none, fileKey: null }).provider.get()).toMatchObject({
      enabled: true,
      apiKey: null,
      source: null,
    });
  });

  it('yumuşak anahtar kapalıyken anahtar verilmez ama sınırlar korunur', async () => {
    const { provider } = make({ rows: () => row({ fallbackEnabled: false, userTurnsPerDay: 9 }) });
    expect(await provider.get()).toMatchObject({
      enabled: false,
      apiKey: null,
      source: null,
      limits: { userTurnsPerDay: 9 },
    });
  });

  it('env sert kapısı kapalıyken DB ayarı ne olursa olsun düşüş kapalıdır ve DB okunmaz', async () => {
    const { provider, calls } = make({ envGate: false });
    expect(await provider.get()).toMatchObject({ enabled: false, apiKey: null });
    expect(await provider.get()).toMatchObject({ enabled: false, apiKey: null });
    expect(calls.load).toBe(0);
  });
});

describe('AS-0409: platform ayarı önbelleği', () => {
  it('TTL (30 sn) içinde DB bir kez okunur; süre dolunca yeniden okunur ve yeni değer görünür', async () => {
    let turns: number | null = 50;
    const { provider, clock, calls } = make({ rows: () => row({ userTurnsPerDay: turns }) });
    expect(PLATFORM_SETTINGS_TTL_MS).toBe(30_000);
    expect((await provider.get()).limits.userTurnsPerDay).toBe(50);
    turns = 10;
    clock.t += 29_999;
    expect((await provider.get()).limits.userTurnsPerDay).toBe(50);
    expect(calls.load).toBe(1);
    clock.t += 2;
    expect((await provider.get()).limits.userTurnsPerDay).toBe(10);
    expect(calls.load).toBe(2);
  });

  it('invalidate anında yeniden okutur; eşzamanlı çağrılar tek okumayı paylaşır', async () => {
    let turns = 1;
    const { provider, calls } = make({ rows: () => row({ userTurnsPerDay: turns }) });
    await Promise.all([provider.get(), provider.get(), provider.get()]);
    expect(calls.load).toBe(1);
    turns = 2;
    provider.invalidate();
    expect((await provider.get()).limits.userTurnsPerDay).toBe(2);
  });

  it('yükleme hatasında kısa süre eski değerle sürer (olay içeriksiz); eski değer yoksa hata verir', async () => {
    let fail = false;
    const { provider, clock, events } = make({
      rows: () => (fail ? new Error('bağlantı yok') : row({ userTurnsPerDay: 7 })),
    });
    await provider.get();
    fail = true;
    clock.t += PLATFORM_SETTINGS_TTL_MS + 1;
    expect((await provider.get()).limits.userTurnsPerDay).toBe(7);
    expect(events).toEqual(['ai.platform_settings_load_failed']);
    // Çok eski değerle sürülmez: sınır gevşemesin diye hata verilir.
    clock.t += 10 * 60_000;
    await expect(provider.get()).rejects.toThrow();
    const cold = make({ rows: () => new Error('bağlantı yok') });
    await expect(cold.provider.get()).rejects.toThrow();
  });
});

describe('AS-0409: platform anahtarı şifre çözme', () => {
  it('yanlış bağlamda/sürümde şifrelenmiş kayıt çözülemez: sır dosyasına düşer ve yalnız olay adı üretir', async () => {
    const wrongCtx = encryptField(
      derivePlatformKey(KEK),
      orgKeyContext('00000000-0000-4000-8000-000000000001', 1),
      DB_KEY,
    );
    const a = make({ rows: () => row({ keyEnc: wrongCtx }) });
    expect(await a.provider.get()).toMatchObject({ apiKey: FILE_KEY, source: 'server_secret' });
    expect(a.events).toEqual(['ai.platform_key_decrypt_failed']);
    // Sürüm uyuşmazlığı (AAD'ye bağlı).
    const b = make({ rows: () => row({ keyVersion: 2 }) });
    expect(await b.provider.get()).toMatchObject({ source: 'server_secret' });
    // Başka KEK ile şifrelenmiş.
    const otherKek = encryptField(
      derivePlatformKey(Buffer.alloc(32, 9)),
      platformKeyContext(1),
      DB_KEY,
    );
    const c = make({ rows: () => row({ keyEnc: otherKek }) });
    expect((await c.provider.get()).apiKey).toBe(FILE_KEY);
    expect(JSON.stringify(a.events) + JSON.stringify(b.events)).not.toContain(DB_KEY);
  });

  it('şifreli değer değişmedikçe yeniden çözülmez; değişince yeni anahtar görünür', async () => {
    const NEW_KEY = `sk-ant-test-${'N'.repeat(30)}new2`;
    let current = row();
    const { provider } = make({ rows: () => current });
    expect((await provider.get()).apiKey).toBe(DB_KEY);
    current = row({ keyEnc: seal(NEW_KEY), keyLast4: 'new2' });
    provider.invalidate();
    expect((await provider.get()).apiKey).toBe(NEW_KEY);
  });
});

describe('AS-0409: env sert kapısı (ikinci savunma)', () => {
  const cfg = (edaEnv: string, flag: boolean) =>
    ({ env: { EDA_ENV: edaEnv, PLATFORM_AI_KEY_FALLBACK: flag } }) as never;

  it('bayrak true olsa bile production/staging/onprem ortamında düşüş kapalıdır (DB ayarı etkisiz)', () => {
    for (const e of ['production', 'staging', 'onprem']) {
      expect(platformFallbackEnabled(cfg(e, true)), e).toBe(false);
    }
    for (const e of ['development', 'test', 'beta-synthetic']) {
      expect(platformFallbackEnabled(cfg(e, true)), e).toBe(true);
      expect(platformFallbackEnabled(cfg(e, false)), e).toBe(false);
    }
  });
});
