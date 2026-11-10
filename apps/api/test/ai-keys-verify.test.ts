// @tk TK-28
// #54 BYOK: sağlayıcı doğrulayıcısı ve hata kataloğu (ağsız; `fetch` enjekte edilir). Anahtar yalnız
// `x-api-key` başlığında gider; hata ve mesajlara sızmaz. Veriler sentetiktir (gerçek anahtar yok).
import { AppError, errorMessageTr } from '@eda/contracts/errors';
import { describe, expect, it } from 'vitest';
import { anthropicVerifier } from '../src/services/ai-keys/crypto.ts';

const KEY = `sk-ant-${'a'.repeat(40)}`;
const res = (status: number) => new Response('{}', { status });

describe('#54: sağlayıcı doğrulayıcısı', () => {
  it('401/403 reddedilir; 200 kabul edilir; ulaşılamayan sağlayıcı hata atar', async () => {
    expect(await anthropicVerifier(async () => res(401))(KEY)).toBe(false);
    expect(await anthropicVerifier(async () => res(403))(KEY)).toBe(false);
    expect(await anthropicVerifier(async () => res(200))(KEY)).toBe(true);
    await expect(anthropicVerifier(async () => res(500))(KEY)).rejects.toThrow();
    await expect(
      anthropicVerifier(async () => {
        throw new Error('ağ yok');
      })(KEY),
    ).rejects.toThrow();
  });

  it('anahtar yalnız x-api-key başlığında gider; adres ve sürüm başlığı sabittir', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    await anthropicVerifier(async (url, init) => {
      seen.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return res(200);
    })(KEY);
    expect(seen).toHaveLength(1);
    const s = seen[0] as { url: string; headers: Record<string, string> };
    expect(s.url.startsWith('https://api.anthropic.com/v1/models')).toBe(true);
    expect(s.url).not.toContain(KEY);
    expect(s.headers['x-api-key']).toBe(KEY);
    expect(s.headers['anthropic-version']).toBe('2023-06-01');
  });
});

describe('#54: hata kataloğu ve mesajlar', () => {
  it('anahtar yok hataları kendi nedenleriyle ve istenen metinle döner', () => {
    const org = new AppError('AI_POLICY_NO_PROVIDER', { reason: 'org_key_missing' });
    const own = new AppError('AI_POLICY_NO_PROVIDER', { reason: 'own_key_missing' });
    expect(org.reason).toBe('org_key_missing');
    expect(own.reason).toBe('own_key_missing');
    expect(errorMessageTr('AI_POLICY_NO_PROVIDER', 'org_key_missing')).toContain(
      'Büro/baroya tanımlanmış API anahtarı yok',
    );
    expect(errorMessageTr('AI_POLICY_NO_PROVIDER', 'own_key_missing')).toContain('Kendi API');
  });

  it('reddedilen anahtar api_key_rejected nedeniyle döner; mesaj anahtarı içermez', () => {
    const e = new AppError('VALIDATION_FAILED', { reason: 'api_key_rejected' });
    expect(e.reason).toBe('api_key_rejected');
    expect(errorMessageTr('VALIDATION_FAILED', 'api_key_rejected')).not.toMatch(/sk-ant/);
  });
});
