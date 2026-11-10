// @tk TK-04
// KK-P04a-7 (KK-042-8) birim kısmı: parola özeti `$argon2id$` (PHC) ve güncel `auth.argon2*`
// parametreleriyle; kayıtlı parametreler güncellerden zayıfsa başarılı doğrulamada yeniden özetlenir,
// başarısız doğrulamada yeniden özet yazılmaz. 042 §2.8 zayıf parola kuralı (e-posta yerel kısmı/ad).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { describe, expect, it, vi } from 'vitest';
import { isWeakPassword } from '../src/auth/app-auth.ts';
import {
  CURRENT_PARAMS,
  createPasswordHasher,
  hashPassword,
  needsRehash,
} from '../src/auth/password.ts';

const PASSWORD = 'uzun-ve-ozgun-bir-parola-42';
const WEAK = { memoryCost: 8192, timeCost: 1, parallelism: 1 };

describe('KK-P04a-7 (KK-042-8): Argon2id parola özeti', () => {
  it('özet $argon2id$ ile başlar ve güncel parametreleri taşır', async () => {
    const h = await hashPassword(PASSWORD);
    expect(h.startsWith('$argon2id$v=19$')).toBe(true);
    expect(h).toContain(
      `m=${CONFIG_DEFAULTS['auth.argon2MemoryKiB']},t=${CONFIG_DEFAULTS['auth.argon2TimeCost']},p=${CONFIG_DEFAULTS['auth.argon2Parallelism']}`,
    );
    expect(needsRehash(h)).toBe(false);
    // Tuz her özette farklıdır.
    expect(await hashPassword(PASSWORD)).not.toBe(h);
  });

  it('zayıf parametreli veya Argon2id olmayan özet yeniden özetlenmeli', async () => {
    expect(needsRehash(await hashPassword(PASSWORD, WEAK))).toBe(true);
    expect(needsRehash('scrypt:abcdef')).toBe(true);
    expect(needsRehash('$argon2id$bozuk')).toBe(true);
  });

  it('başarılı girişte zayıf özet güncel parametrelerle yeniden yazılır; hatalı parolada yazılmaz', async () => {
    const onRehash = vi.fn(async (_old: string, _next: string) => undefined);
    const hasher = createPasswordHasher({ onRehash });
    const weak = await hashPassword(PASSWORD, WEAK);
    expect(await hasher.verify({ hash: weak, password: 'yanlis-parola-0000' })).toBe(false);
    expect(onRehash).not.toHaveBeenCalled();
    expect(await hasher.verify({ hash: weak, password: PASSWORD })).toBe(true);
    expect(onRehash).toHaveBeenCalledTimes(1);
    const [oldHash, newHash] = onRehash.mock.calls[0] ?? ['', ''];
    expect(oldHash).toBe(weak);
    expect(needsRehash(newHash, CURRENT_PARAMS)).toBe(false);
    // Güncel özet yeniden yazılmaz.
    expect(await hasher.verify({ hash: newHash, password: PASSWORD })).toBe(true);
    expect(onRehash).toHaveBeenCalledTimes(1);
  });

  it('bozuk özet doğrulamada false döner (hata fırlatmaz)', async () => {
    const hasher = createPasswordHasher();
    expect(await hasher.verify({ hash: 'bozuk', password: PASSWORD })).toBe(false);
  });
});

describe('042 §2.8: zayıf parola kuralı', () => {
  it('e-posta yerel kısmı, tam e-posta veya ad (Türkçe katlamalı) zayıftır', () => {
    expect(isWeakPassword('ayse.yilmaz.avukat', 'ayse.yilmaz.avukat@ornek.test', 'X')).toBe(true);
    expect(isWeakPassword('AYŞE YILMAZ ÖRNEK', 'a@ornek.test', 'Ayşe Yılmaz Örnek')).toBe(true);
    expect(isWeakPassword(PASSWORD, 'a@ornek.test', 'Ayşe Yılmaz')).toBe(false);
  });
});
