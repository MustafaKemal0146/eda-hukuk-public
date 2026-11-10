// @tk TK-33
// Dilekçe sayfa düzeni: yazı tipi/punto/satır aralığı CSS değişkenleri, PDF ek stili, sözcük sayımı;
// DOCX yazıcısı aynı yüz, boyut (yarım punto) ve aralığı (w:line) yazar; denetimler erişilebilir adlı.
import { DEFAULT_DOC_LAYOUT, type DocLayout } from '@eda/editor/schema';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { buildExportHtml } from '../src/features/chat/document-export.ts';
import { buildDocxBytes } from '../src/features/studio/docx-writer.ts';
import { layoutCssVars, pdfCssOf, wordCount } from '../src/features/studio/page-layout.ts';
import { LayoutControls } from '../src/features/studio/page-layout.tsx';

const CUSTOM: DocLayout = { fontFamily: 'arial', fontSizePt: 11, lineHeight: 1.15 };
const BLOCKS = [{ kind: 'p' as const, align: null, runs: [{ text: 'Metin', marks: [] }] }];

/** Sıkıştırmasız (store) ZIP: belge XML'i baytlarda düz metin olarak bulunur. */
const docXml = (bytes: Uint8Array) => {
  const all = new TextDecoder().decode(bytes);
  const start = all.indexOf('<w:document');
  return all.slice(start, all.indexOf('</w:document>', start));
};

describe('KK-STUDYO-F: DOCX düzeni', () => {
  it('varsayılan: Times New Roman, 12 pt (sz 24), 1,5 aralık (line 360)', () => {
    const xml = docXml(buildDocxBytes('Başlık', BLOCKS));
    expect(xml).toContain('w:ascii="Times New Roman"');
    expect(xml).toContain('<w:sz w:val="24"/>');
    expect(xml).toContain('w:line="360"');
  });

  it('özel düzen: Arial, 11 pt (sz 22), 1,15 aralık (line 276); başlık paragrafı da aynı', () => {
    const xml = docXml(buildDocxBytes('Başlık', BLOCKS, CUSTOM));
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).not.toContain('Times New Roman');
    expect(xml.split('<w:sz w:val="22"/>').length - 1).toBe(2);
    expect(xml).toContain('w:line="276"');
    expect(xml).not.toContain('w:line="360"');
  });
});

describe('KK-STUDYO-F: kâğıt ve PDF düzeni, sözcük sayımı', () => {
  it('CSS değişkenleri düzenden türer; CDN yok, sistem/yerel yüz adı', () => {
    const vars = layoutCssVars(CUSTOM);
    expect(vars['--eda-paper-font']).toMatch(/^Arial/);
    expect(vars['--eda-paper-font-size']).toBe('11pt');
    expect(vars['--eda-paper-line-height']).toBe('1.15');
    expect(layoutCssVars(DEFAULT_DOC_LAYOUT)['--eda-paper-font']).toMatch(/^"Times New Roman"/);
    expect(JSON.stringify(vars)).not.toMatch(/https?:/);
  });

  it("PDF yazdırma gövdesi düzen CSS'ini varsayılan stilden sonra alır", () => {
    const css = pdfCssOf(CUSTOM);
    expect(css).toContain('font-family: "Arial", "Liberation Sans", serif');
    expect(css).toContain('font-size: 11pt');
    expect(css).toContain('line-height: 1.15');
    const html = buildExportHtml('B', '<p>x</p>', css);
    expect(html.indexOf('font-size: 12pt')).toBeLessThan(html.indexOf('font-size: 11pt'));
  });

  it('sözcük sayımı: harf/rakam içeren parçalar; yalnız noktalama sayılmaz', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('Davacı vekili — 12.05.2026 tarihli dilekçe.')).toBe(5);
    expect(wordCount('  çok   boşluk \n yeni satır ')).toBe(4);
  });

  it('düzen denetimleri: üç seçici erişilebilir adlı; yüz adları katalogda', () => {
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'tr',
        messages,
        timeZone: 'Europe/Istanbul',
        children: createElement(LayoutControls, {
          layout: CUSTOM,
          disabled: false,
          onChange: () => {},
        }),
      }),
    );
    const L = messages.studio.layout;
    for (const label of [L.font, L.size, L.spacing])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('>11 pt<');
    expect(html).toContain('>1,15<');
    expect(html).toContain(L.fonts['times-new-roman']);
    expect(messages.studio.counts.words).toContain('{count}');
  });
});
