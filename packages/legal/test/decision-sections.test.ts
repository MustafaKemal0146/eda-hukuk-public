// @tk TK-18
// KK-P11-16 / KK-034-4 (alt küme): karar bölümleyici (034 §6, P11 K1). Metinler SENTETİK yapı örnekleridir:
// gerçek karar metni değildir, yalnız başlık biçimlerini taşır. Altın dosyalar `test/golden/sections/`;
// kayıtlı resmî belgelerle uçtan uca bölümleme testleri yargi-mcp'dedir (get-decision, anayasa); altın
// küme P14a'da genişler.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { roleOfLine, splitDecisionSections } from '../src/sections/index.ts';

const GOLDEN_DIR = fileURLToPath(new URL('./golden/sections/', import.meta.url));
const Golden = z.strictObject({
  id: z.string(),
  synthetic: z.literal(true),
  note: z.string(),
  profile: z.enum(['default', 'aym', 'uyusmazlik']),
  lines: z.array(z.string()),
  roles: z.array(z.string()).min(1),
  gerekceExcludes: z.array(z.string()),
});
const goldens = readdirSync(GOLDEN_DIR)
  .filter((n) => n.startsWith('decision-') && n.endsWith('.json'))
  .sort()
  .map((n) => Golden.parse(JSON.parse(readFileSync(join(GOLDEN_DIR, n), 'utf8'))));

describe('KK-P11-16: başlık satırı rolleri', () => {
  it('künye alanı ("KARAR : …") başlık sayılmaz; "VI. KARAR" hüküm başlığıdır', () => {
    expect(roleOfLine('KARAR : Davanın kabulü')).toBeNull();
    expect(roleOfLine('VI. KARAR')).toBe('hukum');
    expect(roleOfLine('C. Gerekçe')).toBe('gerekce');
    expect(roleOfLine('B. Temyiz Sebepleri')).toBe('taraf_iddiasi');
    expect(roleOfLine('SAVUNMANIN ÖZETİ : Davalı idare savunma vermiştir.')).toBe('taraf_iddiasi');
    // Eski Yargıtay biçimi: "K A R A R" gerekçe, "SONUÇ: …" hüküm.
    expect(roleOfLine('K A R A R')).toBe('gerekce');
    expect(roleOfLine('SONUÇ: Yukarıda açıklanan nedenlerle onanmasına')).toBe('hukum');
    expect(roleOfLine('Dosya incelenerek gereği düşünüldü:')).toBe('gerekce');
  });

  it('küçük harfli başlık Türkçe büyük harfe çevrilerek eşleşir (i → İ, ı → I)', () => {
    expect(roleOfLine('**İstinaf sebepleri**')).toBe('taraf_iddiasi');
    expect(roleOfLine('## Davanın özeti : örnek')).toBe('istem');
    expect(roleOfLine('Danıştay Tetkik Hakimi : Örnek Ad')).toBe('tetkik_hakimi');
  });

  it('profil kalıpları: AYM ve Uyuşmazlık belge başı "KARAR" künyedir; başvuranın gerekçesi taraf iddiasıdır', () => {
    expect(roleOfLine('KARAR', 'aym')).toBe('kunye');
    expect(roleOfLine('K A R A R', 'uyusmazlik')).toBe('kunye');
    expect(roleOfLine('İTİRAZIN GEREKÇESİ', 'aym')).toBe('taraf_iddiasi');
    expect(roleOfLine('ESASIN İNCELENMESİ', 'aym')).toBe('gerekce');
    // 034 §6.3 genel kalıbı (P14a.4): yalnız yüksek mahkeme profiline özgü değil.
    expect(roleOfLine('ESASIN İNCELENMESİ')).toBe('gerekce');
  });
});

describe('KK-P11-16 / KK-034-4: bölümleme altın dosyaları', () => {
  it('altın küme boş değil', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(4);
  });

  for (const g of goldens) {
    it(`${g.id}: roller ${g.roles.join(' > ')}; gerekce taraf / tetkik metni içermez`, () => {
      const sections = splitDecisionSections(g.lines.join('\n'), g.profile);
      expect(sections.map((s) => s.role)).toEqual(g.roles);
      const gerekce = sections
        .filter((s) => s.role === 'gerekce')
        .map((s) => s.text)
        .join('\n');
      for (const phrase of g.gerekceExcludes) expect(gerekce).not.toContain(phrase);
    });
  }

  it('boş metin bölüm üretmez', () => {
    expect(splitDecisionSections('  \n ')).toEqual([]);
  });

  it('aynı role ait ardışık başlık yeni bölüm açmaz', () => {
    const text = 'GEREKÇE\nBir.\nDEĞERLENDİRME\nİki.';
    expect(splitDecisionSections(text)).toEqual([{ role: 'gerekce', text }]);
  });
});
