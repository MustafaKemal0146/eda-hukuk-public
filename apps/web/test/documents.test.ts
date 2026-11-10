import { describe, expect, it } from 'vitest';
import {
  documentsOf,
  rehypePlaceholders,
  splitDocuments,
  wordCount,
} from '../src/features/chat/documents.ts';

const FULL =
  'Taslağı hazırladım.\n\n```belge\n# Kira Bedelinin Tespiti Dilekçesi\n\nDAVACI: [[Doldurulacak: ad soyad]]\nSonuç ve istem.\n```\n\nKontrol notları:\n- TBK m. 344 [K1]';

describe('splitDocuments', () => {
  it('belge bloğunu kart verisine, kalan metni metne ayırır', () => {
    const segs = splitDocuments(FULL);
    expect(segs.map((s) => s.type)).toEqual(['text', 'document', 'text']);
    const doc = documentsOf(FULL)[0];
    expect(doc?.title).toBe('Kira Bedelinin Tespiti Dilekçesi');
    expect(doc?.complete).toBe(true);
    expect(doc?.body).toContain('DAVACI');
    expect(doc?.body).not.toContain('Kira Bedelinin');
  });
  it('akışta kapanmamış bloğu tamamlanmamış sayar ve ham çit göstermez', () => {
    const doc = documentsOf('Giriş.\n\n```belge\nBaşlık\nİlk paragraf')[0];
    expect(doc?.complete).toBe(false);
    expect(doc?.title).toBe('Başlık');
    const partial = splitDocuments('Giriş.\n\n```bel');
    expect(partial).toEqual([{ type: 'text', value: 'Giriş.\n' }]);
  });
  it('belge bloğu yoksa metin aynen döner; diğer kod blokları belge sayılmaz', () => {
    expect(splitDocuments('Düz yanıt')).toEqual([{ type: 'text', value: 'Düz yanıt' }]);
    expect(documentsOf('```ts\nconst a = 1;\n```')).toHaveLength(0);
  });
  it('birden çok belgeyi sırayla numaralar', () => {
    const t = '```belge\nA\nx\n```\nara\n```belge\nB\ny\n```';
    expect(documentsOf(t).map((d) => [d.index, d.title])).toEqual([
      [0, 'A'],
      [1, 'B'],
    ]);
  });
});

describe('rehypePlaceholders', () => {
  it('[[Doldurulacak: ...]] işaretini mark öğesine çevirir, kodu atlar', () => {
    const tree = {
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [{ type: 'text', value: 'Taraf [[Doldurulacak: ad]] burada.' }],
        },
        {
          type: 'element',
          tagName: 'code',
          children: [{ type: 'text', value: '[[Doldurulacak: kod]]' }],
        },
      ],
    };
    rehypePlaceholders()(tree);
    const p = tree.children[0] as { children: { type: string; tagName?: string }[] };
    expect(p.children.map((c) => c.tagName ?? c.type)).toEqual(['text', 'mark', 'text']);
    const code = tree.children[1] as { children: { type: string }[] };
    expect(code.children[0]?.type).toBe('text');
  });
});

describe('wordCount', () => {
  it('sözcükleri sayar', () => {
    expect(wordCount('Davacı, kira bedeli 5.000 TL')).toBe(6);
  });
});

import { buildExportHtml, fileSlug } from '../src/features/chat/document-export.ts';

describe('belge dışa aktarma', () => {
  it("dosya adını Türkçe harflerden ASCII'ye çevirir", () => {
    expect(fileSlug("ANKARA ASLİYE HUKUK MAHKEMESİ'NE")).toBe('ankara-asliye-hukuk-mahkemesi-ne');
    expect(fileSlug('   ')).toBe('belge');
  });
  it('çıktı belgesi başlığı kaçışlar ve gövdeyi sarar', () => {
    const html = buildExportHtml('A <b> & "B"', '<p>metin</p>');
    expect(html).toContain('<title>A &lt;b&gt; &amp; &quot;B&quot;</title>');
    expect(html).toContain('<body><p>metin</p></body>');
    expect(html).toContain('charset="utf-8"');
  });
});
