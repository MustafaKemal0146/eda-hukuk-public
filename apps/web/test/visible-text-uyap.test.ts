// @tk TK-33
// Ürün kararı (2026-10-17): kullanıcıya görünen hiçbir metinde "Bedesten" geçmez; portalın görünen
// adı "UYAP". Teknik ad (`bedesten.adalet.gov.tr` ana makinesi, `bedesten` kod anahtarı) kodda kalır;
// bu test yalnız görünen metin dosyalarını tarar: web ve admin `tr` katalogları, e-posta şablonları,
// sözleşmedeki Türkçe hata mesajları. Büyük/küçük harf duyarsızdır.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const VISIBLE_TEXT_FILES = [
  'apps/web/messages/tr.json',
  'apps/admin/messages/tr.json',
  'packages/contracts/src/errors/messages.tr.ts',
  ...readdirSync(join(ROOT, 'packages/email/src/templates'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `packages/email/src/templates/${f}`),
];

describe('Görünen metinde "Bedesten" yok; görünen ad UYAP', () => {
  it('katalog, e-posta şablonu ve hata mesajı dosyalarında sözcük geçmez', () => {
    expect(VISIBLE_TEXT_FILES.length).toBeGreaterThan(5);
    const hits = VISIBLE_TEXT_FILES.flatMap((f) =>
      readFileSync(join(ROOT, f), 'utf8')
        .split('\n')
        // Katalog anahtarı (`"bedesten": …`) iç kod anahtarıdır, görünen metin değil.
        .map((line, i) => ({ f, line: i + 1, text: line.replace(/"bedesten"\s*:/gu, '') }))
        .filter((x) => /bedesten/iu.test(x.text))
        .map((x) => `${x.f}:${x.line}`),
    );
    expect(hits).toEqual([]);
  });

  it('kaynak panelindeki portal adı UYAP; iç kod anahtarı görünen metin değildir', () => {
    expect(messages.chat.sources.portals.bedesten).toBe('UYAP');
    expect(messages.chat.sources.portals.bedesten).not.toMatch(/bedesten/i);
  });
});
