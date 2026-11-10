import { describe, expect, it } from 'vitest';
import {
  blocksToDoc,
  docToBlocks,
  markdownToBlocks,
  parseInline,
} from '../src/features/studio/doc-convert.ts';
import { buildDocxBytes, crc32 } from '../src/features/studio/docx-writer.ts';

describe("KK-P18-1: sohbet belge bloğu -> editör JSON'u (yapı taşınır, metin uydurulmaz)", () => {
  it('satır içi biçim işaretlerini çalıştırmalara böler', () => {
    expect(parseInline('Düz **kalın** ve *italik*')).toEqual([
      { text: 'Düz ', marks: [] },
      { text: 'kalın', marks: ['bold'] },
      { text: ' ve ', marks: [] },
      { text: 'italik', marks: ['italic'] },
    ]);
  });

  it('başlık, paragraf ve listeleri bloklara çevirir; her metin satırı ayrı paragraftır', () => {
    const blocks = markdownToBlocks(
      '# Başlık\n\nBirinci satır\nikinci satır\n\n- a\n- b\n\n1. bir\n2. iki',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['h', 'p', 'p', 'li', 'li', 'li', 'li']);
    const p = blocks[1];
    if (p?.kind === 'p') expect(p.runs[0]?.text).toBe('Birinci satır');
    const q = blocks[2];
    if (q?.kind === 'p') expect(q.runs[0]?.text).toBe('ikinci satır');
  });

  it('bölümleri freeSection ve blockId ile üretir, ardışık maddeleri tek listede toplar', () => {
    const doc = blocksToDoc(markdownToBlocks('Giriş\n\n- a\n- b'));
    expect(doc.content).toHaveLength(2);
    const [s0, s1] = doc.content as {
      attrs: { role: string; blockId: string };
      content: { type: string; content?: unknown[] }[];
    }[];
    expect(s0?.attrs.role).toBe('freeSection');
    expect(s0?.attrs.blockId).toMatch(/^b-[A-Za-z0-9_-]+$/);
    expect(s1?.content[0]?.type).toBe('bulletList');
    expect(s1?.content[0]?.content).toHaveLength(2);
  });

  it('boş belge tek boş bölüm döndürür', () => {
    expect(blocksToDoc([]).content).toHaveLength(1);
  });

  it('[[Doldurulacak]] metni olduğu gibi korunur', () => {
    const blocks = markdownToBlocks('DAVACI : [[Doldurulacak: ad soyad]]');
    const b = blocks[0];
    expect(b?.kind === 'p' && b.runs.map((r) => r.text).join('')).toBe(
      'DAVACI : [[Doldurulacak: ad soyad]]',
    );
  });

  it("editör JSON'u bloklara geri döner (gidiş-dönüş)", () => {
    const doc = blocksToDoc(markdownToBlocks('# Başlık\n\nMetin **kalın**\n\n- a'));
    const back = docToBlocks(doc);
    expect(back.map((b) => b.kind)).toEqual(['h', 'p', 'li']);
  });
});

describe('KK-P19-docx: bağımlılıksız DOCX yazıcı', () => {
  it('CRC-32 bilinen vektörle eşleşir', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('ZIP imzası, üç parça ve vurgulu yer tutucu içerir', () => {
    const bytes = buildDocxBytes(
      'Dilekçe',
      markdownToBlocks('KONU : [[Doldurulacak: konu]] & test'),
    );
    const text = new TextDecoder().decode(bytes);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('word/document.xml');
    expect(text).toContain('w:highlight w:val="yellow"');
    expect(text).toContain('&amp; test');
    expect(text).toContain('w:w="11906"');
  });
});
