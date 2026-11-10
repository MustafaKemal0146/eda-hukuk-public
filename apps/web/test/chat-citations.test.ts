// @tk TK-33
// KK-P10-11 (KK-053-02-14): streamdown sertleştirmesi ve `[K#]` -> kısa künye çipi. KK-P10-13:
// kopyalama kısa künye + kaynak listesiyle, etiketsiz. Künyeler sentetiktir (yalnız biçim).
import type { SourceItem } from '@eda/contracts/stream';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CITE_TAG,
  citedRefs,
  hideToolNames,
  protectPartialCitation,
  rehypeCitations,
  serializeForCopy,
  splitCitations,
} from '../src/features/chat/citations.ts';
import {
  type CitationContextValue,
  MessageContent,
} from '../src/features/chat/message-content.tsx';

const S1: SourceItem = {
  ref: 'K1',
  kind: 'decision',
  sourceId: 'ornek-1',
  shortKunye: 'Örnek HD 2000/1 E.',
  title: 'Örnek karar başlığı',
  origin: 'live',
  retrievedAt: '2026-10-10',
  relevance: 'high',
};
const S2: SourceItem = { ...S1, ref: 'K2', sourceId: 'ornek-2', shortKunye: 'Örnek HD 2000/2 E.' };

function ctx(over: Partial<CitationContextValue> = {}): CitationContextValue {
  return {
    sources: new Map([
      ['K1', S1],
      ['K2', S2],
    ]),
    statuses: new Map([['K1', 'verified']]),
    onActivate: () => undefined,
    labels: {
      chip: (k, s) => (s ? `Kaynak: ${k}. Durum: ${s}.` : `Kaynak: ${k}`),
      unresolved: 'Kaynak etiketi çözülemedi',
    },
    ...over,
  };
}

function html(text: string, streaming = false, c = ctx()): string {
  return renderToStaticMarkup(createElement(MessageContent, { text, streaming, citations: c }));
}

describe('KK-P10-11: [K#] ayrıştırma', () => {
  it('tam etiket ve toleranslı çoklu biçim çipe döner; yarım etiket metin kalır', () => {
    expect(splitCitations('a [K1] b [K2, K10] c [K')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'cite', refs: ['K1'] },
      { type: 'text', value: ' b ' },
      { type: 'cite', refs: ['K2', 'K10'] },
      { type: 'text', value: ' c [K' },
    ]);
    expect(splitCitations('[K0] [k1] [K1')).toEqual([{ type: 'text', value: '[K0] [k1] [K1' }]);
    expect(citedRefs('[K2] [K1] [K2]')).toEqual(['K2', 'K1']);
  });

  it('akış sonundaki yarım etiket korunur, kod içinde dokunulmaz', () => {
    expect(protectPartialCitation('Bkz. [K')).toBe('Bkz. &#91;K');
    expect(protectPartialCitation('Bkz. [K3, K')).toBe('Bkz. &#91;K3, K');
    expect(protectPartialCitation('Bkz. [')).toBe('Bkz. &#91;');
    expect(protectPartialCitation('Bkz. [K3]')).toBe('Bkz. [K3]');
    expect(protectPartialCitation('[metin')).toBe('[metin');
    expect(protectPartialCitation('```\nx [K')).toBe('```\nx [K');
    expect(protectPartialCitation('a `x [K')).toBe('a `x [K');
  });

  it('rehype eklentisi kod ve bağlantı içinde etiket işlemez', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [
            { type: 'text', value: 'Bkz. [K' },
            { type: 'text', value: '1] ve ' },
            { type: 'element', tagName: 'code', children: [{ type: 'text', value: '[K1]' }] },
            { type: 'element', tagName: 'a', children: [{ type: 'text', value: '[K2]' }] },
          ],
        },
      ],
    };
    rehypeCitations()(tree);
    const p = tree.children[0] as { children: { type: string; tagName?: string }[] };
    expect(p.children.map((c) => c.tagName ?? c.type)).toEqual([
      'text',
      CITE_TAG,
      'text',
      'code',
      'a',
    ]);
  });
});

describe('KK-P10-11: MessageContent sertleştirmesi', () => {
  it('çip kısa künyeyi gösterir (K numarasını değil), durum ve erişilebilir ad taşır', () => {
    const out = html('Metin [K1] ve [K2].');
    expect(out).toContain('Örnek HD 2000/1 E.');
    expect(out).toContain('data-status="verified"');
    expect(out).toContain('aria-label="Kaynak: Örnek HD 2000/1 E.. Durum: verified."');
    // K2 durumsuz: nötr çip.
    expect(out).toContain('Örnek HD 2000/2 E.');
    expect(out).not.toContain('[K1]');
    expect(out).not.toContain('>K1<');
  });

  it('çözülemeyen etiket gri "?" çipidir', () => {
    expect(html('Bkz. [K9].')).toContain('Kaynak etiketi çözülemedi');
  });

  it('ham HTML öğe olarak çizilmez, görsel ve markdown görüntüsü yok', () => {
    const out = html(
      'a <b>kalın</b> <img src="x" onerror="y"> ![g](https://bedesten.adalet.gov.tr/g.png)',
    );
    expect(out).not.toMatch(/<b>|<img|<script/);
    expect(out).not.toContain('g.png');
  });

  it('bağlantı yalnız izinli resmî alan adında tıklanır; diğeri düz metin', () => {
    const out = html(
      '[dış](https://ornek.com/x) [resmî](https://www.mevzuat.gov.tr/x) [http](http://mevzuat.gov.tr/x)',
    );
    expect(out).not.toContain('ornek.com');
    expect(out).toContain('href="https://www.mevzuat.gov.tr/x"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain('href="http://mevzuat.gov.tr/x"');
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it('başlıklar h3e iner; kod ve satır içi kodda çip yok', () => {
    const out = html('# Bir\n\n## İki\n\n`[K1]`\n\n```\n[K1]\n```');
    expect(out).not.toMatch(/<h1|<h2/);
    expect(out.match(/<h3/g)).toHaveLength(2);
    expect(out).not.toContain('data-slot="chip"');
  });

  it('akışta yarım etiket ham kalır, tam etiket çipe döner', () => {
    const out = html('Bkz. [K1] ve [K2', true);
    expect(out).toContain('Örnek HD 2000/1 E.');
    expect(out).toContain('ve [K2');
    expect(out).not.toContain('incomplete-link');
  });
});

describe('KK-P10-13: kopyalama serileştirmesi', () => {
  it('etiketler kısa künyeyle yazılır, sonda kaynak listesi; etiket kalmaz', () => {
    const sources = new Map([
      ['K1', S1],
      ['K2', S2],
    ]);
    const out = serializeForCopy('Birinci [K1]. İkinci [K2, K1].', sources, 'Kaynaklar');
    expect(out).not.toMatch(/\[K\d/);
    expect(out).toContain('Birinci (Örnek HD 2000/1 E.).');
    expect(out).toContain('(Örnek HD 2000/2 E.; Örnek HD 2000/1 E.)');
    expect(out).toContain(
      'Kaynaklar\n- Örnek HD 2000/1 E. — Örnek karar başlığı\n- Örnek HD 2000/2 E.',
    );
  });

  it('kaynaksız metin olduğu gibi kopyalanır', () => {
    expect(serializeForCopy('Düz metin.', new Map(), 'Kaynaklar')).toBe('Düz metin.');
  });
});

describe('#62: iç araç adları kullanıcıya gösterilmez', () => {
  it('araç adları okunur karşılıklarıyla değişir; sıradan metne dokunulmaz', () => {
    expect(hideToolNames('Madde metni get_legislation_article ile doğrulanmalı.')).toBe(
      'Madde metni madde metni getirme ile doğrulanmalı.',
    );
    expect(hideToolNames('süreyi calculate_deadline ile, search_decisions sonra')).toBe(
      'süreyi süre hesabı ile, karar araması sonra',
    );
    expect(hideToolNames('Yargıtay kararı [K1] ve TBK m. 344')).toBe(
      'Yargıtay kararı [K1] ve TBK m. 344',
    );
  });
});
