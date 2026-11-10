// @tk TK-33
// KK-052-5.1 (MessageActions "Dışa aktar"): yanıt Word'e (.docx) künye render edilmiş metin, "Kaynaklar"
// listesi (portal adı + erişim tarihi) ve zorunlu ibareyle aktarılır; `not_found` atıf dışa aktarımı
// engeller (025 §1 madde 3). Üretilen paket açılıp `word/document.xml` metni doğrulanır. Künyeler
// sentetiktir (yalnız biçim).
import { Announcer } from '@eda/ui';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import {
  type AnswerExportLabels,
  buildAnswerDocx,
  type ExportSource,
  exportBlocked,
  renderCitations,
} from '../src/features/chat/answer-export.ts';
import { AssistantMessage } from '../src/features/chat/chat-message.tsx';
import type { EdaUIMessage } from '../src/features/chat/chat-types.ts';
import { fileSlug } from '../src/features/chat/document-export.ts';
import { zipRead } from '../src/features/converter/zip-reader.ts';

const SOURCES = new Map<string, ExportSource>([
  [
    'K1',
    {
      shortKunye: 'Örnek Daire 2099/1 E., 2099/2 K.',
      title: 'Sentetik karar',
      portal: 'UYAP',
      accessDate: '17.10.2026',
    },
  ],
  [
    'K2',
    {
      shortKunye: 'Örnek Kanun m. 99',
      title: '',
      portal: 'Mevzuat Bilgi Sistemi',
      accessDate: null,
    },
  ],
]);

const LABELS: AnswerExportLabels = {
  title: 'E.D.A. yanıtı',
  sourcesHeading: 'Kaynaklar',
  sourceLine: (s) =>
    `${s.title ? `${s.shortKunye} — ${s.title}` : s.shortKunye}. ${s.portal}${
      s.accessDate ? `, erişim tarihi ${s.accessDate}` : ''
    }`,
  disclaimers: ['Zorunlu ibare: taslak aracıdır.'],
};

async function documentText(bytes: Uint8Array): Promise<string> {
  const xml = await zipRead(bytes, 'word/document.xml');
  if (xml === null) throw new Error('document.xml yok');
  return new TextDecoder()
    .decode(xml)
    .replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => `${p.replace(/<[^>]+>/g, '')}\n`)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

describe('KK-052-5.1 yanıtı Word’e aktarma', () => {
  it('[K#] yerine künye, sonda erişim tarihli kaynak listesi ve zorunlu ibare yazılır', async () => {
    const text =
      '## Değerlendirme\n\nİşçi alacağı **zamanaşımına** tabidir [K1]. Kanun hükmü [K2] ve [K1, K2].\n\n- madde [K9]';
    const out = await documentText(buildAnswerDocx(text, SOURCES, LABELS));
    expect(out).toContain('E.D.A. yanıtı');
    expect(out).toContain('tabidir (Örnek Daire 2099/1 E., 2099/2 K.).');
    expect(out).toContain('Kanun hükmü (Örnek Kanun m. 99)');
    expect(out).toContain('(Örnek Daire 2099/1 E., 2099/2 K.; Örnek Kanun m. 99)');
    // Kayıtta olmayan etiket uydurulmaz: ham kalır, listeye girmez.
    expect(out).toContain('madde [K9]');
    expect(out).not.toMatch(/\[K[12]\]/);
    const tail = out.slice(out.lastIndexOf('Kaynaklar'));
    expect(tail).toContain(
      '1. Örnek Daire 2099/1 E., 2099/2 K. — Sentetik karar. UYAP, erişim tarihi 17.10.2026',
    );
    expect(tail).toContain('2. Örnek Kanun m. 99. Mevzuat Bilgi Sistemi');
    expect(tail).not.toContain('K9');
    expect(out.trimEnd().endsWith('Zorunlu ibare: taslak aracıdır.')).toBe(true);
  });

  it('atıf yoksa kaynak başlığı yazılmaz, ibare yine yazılır; bağlantı yalnız metne iner', async () => {
    const out = await documentText(
      buildAnswerDocx('Genel bilgi [resmî sayfa](https://example.invalid/x).', SOURCES, LABELS),
    );
    expect(out).not.toContain('Kaynaklar');
    expect(out).toContain('Genel bilgi resmî sayfa.');
    expect(out).not.toContain('https://');
    expect(out).toContain('Zorunlu ibare');
  });

  it('belge bloğu başlığı ve gövdesi aktarılır', async () => {
    const text =
      'Taslak aşağıda.\n\n```belge\n# İHTARNAME\nMuhatap: [[Doldurulacak: ad]] [K1]\n```\n';
    const out = await documentText(buildAnswerDocx(text, SOURCES, LABELS));
    expect(out).toContain('İHTARNAME');
    expect(out).toContain('(Örnek Daire 2099/1 E., 2099/2 K.)');
    expect(out).not.toContain('```');
  });

  it('künye XML kaçışlanır (model/kaynak metni ham XML olarak yazılmaz)', async () => {
    const src = new Map<string, ExportSource>([
      ['K1', { shortKunye: 'A <b> & C', title: '', portal: 'UYAP', accessDate: null }],
    ]);
    const bytes = buildAnswerDocx('Bkz. [K1]', src, LABELS);
    const raw = new TextDecoder().decode((await zipRead(bytes, 'word/document.xml')) ?? undefined);
    expect(raw).toContain('A &lt;b&gt; &amp; C');
    expect(raw).not.toContain('<b>');
  });

  it('not_found atıf dışa aktarımı engeller; diğer durumlar engellemez', () => {
    expect(exportBlocked([{ status: 'verified' }, { status: 'not_found' }])).toBe(true);
    expect(exportBlocked([{ status: 'verified' }, { status: 'source_unavailable' }])).toBe(false);
    expect(exportBlocked([])).toBe(false);
    expect(exportBlocked(undefined)).toBe(false);
  });

  it('renderCitations kopyalama kuralıyla aynı biçimi verir; dosya adı Türkçe ASCII kebab', () => {
    expect(renderCitations('a [K1] b', SOURCES)).toBe('a (Örnek Daire 2099/1 E., 2099/2 K.) b');
    expect(fileSlug('eda yaniti 2026-10-17')).toBe('eda-yaniti-2026-10-17');
    expect(fileSlug('Şikâyet dilekçesi ÇĞİÖŞÜ')).toBe('sikayet-dilekcesi-cgiosu');
  });
});

describe('KK-052-5.1 "Dışa aktar" düğmesi bir işleve bağlıdır', () => {
  const message = {
    id: '01990000-0000-7000-8000-000000000099',
    role: 'assistant',
    metadata: { status: 'complete' },
    parts: [{ type: 'text', text: 'Sentetik yanıt [K1].' }],
  } as unknown as EdaUIMessage;
  const render = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'tr',
        messages,
        timeZone: 'Europe/Istanbul',
        children: createElement(
          Announcer,
          { coalesceMs: 0 },
          createElement(AssistantMessage, {
            message,
            streaming: false,
            stopped: false,
            pipeline: null,
            sources: [],
            citations: {
              sources: new Map(),
              statuses: new Map(),
              labels: { chip: (k) => k, unresolved: '?' },
            },
            onCopy: () => undefined,
            ...extra,
          }),
        ),
      }),
    );

  it('onExport verilince "Word\'e aktar (.docx)" düğmesi çizilir; verilmezse çizilmez', () => {
    expect(render({ onExport: () => undefined })).toContain(
      'aria-label="Word&#x27;e aktar (.docx)"',
    );
    expect(render({})).not.toContain('Word&#x27;e aktar');
  });

  it('akış sürerken düğme çizilmez', () => {
    expect(render({ onExport: () => undefined, streaming: true })).not.toContain(
      'Word&#x27;e aktar',
    );
  });

  it('zorunlu ibare ve engel metinleri katalogdadır (Y-86, Y-87 birebir)', () => {
    expect(messages.legal.mandatory.y86).toContain('taslak aracıdır');
    expect(messages.legal.mandatory.y87).toContain('hukuki değerlendirme');
    expect(messages.chat.message.exportBlocked).toContain('Word');
  });
});
