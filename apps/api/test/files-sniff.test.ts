// @tk TK-04
// KK-P20-6 (KK-033-1/2): tür doğrulaması içeriktendir; uzantı yalnız tutarlılık denetimi, istemci
// Content-Type hiç okunmaz. Evrak adı normalizasyonu ve güvenli Content-Disposition.
import { AppError } from '@eda/contracts/errors';
import { describe, expect, it } from 'vitest';
import {
  asciiFallbackName,
  contentDisposition,
  normalizeFileName,
} from '../src/services/files/names.ts';
import { createUploadSlots } from '../src/services/files/slots.ts';
import { sniffFile } from '../src/services/files/sniff.ts';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const TIFF_LE = Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
const TIFF_BE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);
const BIGTIFF = Buffer.from([0x49, 0x49, 0x2b, 0x00, 8, 0, 8, 0]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]);
const TXT = Buffer.from('Örnek metin: işçilik alacağı.\n', 'utf8');

function reasonOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError && e.code === 'FILE_TYPE_NOT_ALLOWED') return String(e.reason);
    throw e;
  }
  return null;
}

describe('KK-P20-6 (KK-033-1): magic byte ile tür kararı', () => {
  it.each([
    [PDF, 'dilekce.pdf', 'pdf', 'application/pdf'],
    [PDF, 'DILEKCE.PDF', 'pdf', 'application/pdf'],
    [PNG, 'a.png', 'png', 'image/png'],
    [JPG, 'a.jpg', 'jpeg', 'image/jpeg'],
    [JPG, 'a.JPEG', 'jpeg', 'image/jpeg'],
    [TIFF_LE, 'tarama.tif', 'tiff', 'image/tiff'],
    [TIFF_BE, 'tarama.tiff', 'tiff', 'image/tiff'],
    [
      ZIP,
      'sozlesme.docx',
      'docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    [ZIP, 'karar.udf', 'udf', 'application/octet-stream'],
    [TXT, 'not.txt', 'txt', 'text/plain; charset=utf-8'],
  ] as const)('%#: %s kabul edilir', (head, name, type, mime) => {
    const r = sniffFile(head, name);
    expect(r.fileType).toBe(type);
    expect(r.mimeType).toBe(mime);
  });

  it('uzantı ile içerik uyuşmazlığı type_mismatch', () => {
    expect(reasonOf(() => sniffFile(PDF, 'resim.png'))).toBe('type_mismatch');
    expect(reasonOf(() => sniffFile(PNG, 'belge.pdf'))).toBe('type_mismatch');
    expect(reasonOf(() => sniffFile(JPG, 'x.tif'))).toBe('type_mismatch');
    expect(reasonOf(() => sniffFile(ZIP, 'x.pdf'))).toBe('type_mismatch');
    expect(reasonOf(() => sniffFile(Buffer.from('düz yazı'), 'x.pdf'))).toBe('type_mismatch');
  });

  it('kabul edilmeyen türler unsupported: zip, docm, md, çalıştırılabilir, BigTIFF, uzantısız', () => {
    expect(reasonOf(() => sniffFile(ZIP, 'arsiv.zip'))).toBe('unsupported');
    expect(reasonOf(() => sniffFile(ZIP, 'makro.docm'))).toBe('unsupported');
    expect(reasonOf(() => sniffFile(ZIP, 'tablo.xlsm'))).toBe('unsupported');
    expect(reasonOf(() => sniffFile(TXT, 'not.md'))).toBe('unsupported');
    expect(reasonOf(() => sniffFile(Buffer.from('MZ\x90\x00'), 'kurulum.exe'))).toBe('unsupported');
    expect(reasonOf(() => sniffFile(BIGTIFF, 'buyuk.tif'))).toBe('unsupported');
    expect(reasonOf(() => sniffFile(Buffer.from([1, 2, 3]), 'adsiz'))).toBe('unsupported');
  });

  it('çalıştırılabilir içerik .pdf adıyla gelirse reddedilir (imza yok)', () => {
    expect(reasonOf(() => sniffFile(Buffer.from('MZ\x90\x00\x03'), 'zararsiz.pdf'))).toBe(
      'type_mismatch',
    );
  });

  it('txt: NUL ve denetim karakteri, geçersiz UTF-8 reddedilir; BOM ve UTF-16 BOM kabul', () => {
    expect(reasonOf(() => sniffFile(Buffer.from('a\u0000b'), 'x.txt'))).toBe('type_mismatch');
    expect(reasonOf(() => sniffFile(Buffer.from([0x61, 0xff, 0xfe, 0xfd, 0x62]), 'x.txt'))).toBe(
      'type_mismatch',
    );
    expect(reasonOf(() => sniffFile(Buffer.from('a\u0007b'), 'x.txt'))).toBe('type_mismatch');
    expect(sniffFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), TXT]), 'x.txt').fileType).toBe(
      'txt',
    );
    expect(sniffFile(Buffer.from([0xff, 0xfe, 0x61, 0x00]), 'x.txt').fileType).toBe('txt');
    expect(sniffFile(Buffer.from('satır\r\nsatır\ttab\f'), 'x.txt').fileType).toBe('txt');
  });

  it('8 KiB sınırı çok baytlı karakteri bölse de geçerli UTF-8 reddedilmez', () => {
    const text = Buffer.from('ş'.repeat(5000), 'utf8').subarray(0, 8191);
    expect(sniffFile(text, 'uzun.txt').fileType).toBe('txt');
  });

  it('reddedilen tür yanıtı izinli türleri bildirir', () => {
    try {
      sniffFile(ZIP, 'a.zip');
    } catch (e) {
      expect((e as AppError).meta?.allowedTypes).toEqual([
        'pdf',
        'docx',
        'udf',
        'png',
        'jpeg',
        'tiff',
        'txt',
      ]);
    }
  });
});

describe('KK-P20-6 (KK-033-18): evrak adı ve Content-Disposition', () => {
  it('NFC, denetim karakterleri ve yol ayırıcıları atılır; ≤ 200 karakter', () => {
    expect(normalizeFileName('Aysė.pdf')).toBe('Aysė.pdf'.normalize('NFC'));
    expect(normalizeFileName('..\\..\\etc/passwd')).toBe('etcpasswd');
    expect(normalizeFileName('a\r\nb\u0000c.pdf')).toBe('abc.pdf');
    expect(normalizeFileName('   ')).toBe('evrak');
    expect(normalizeFileName(`${'ş'.repeat(300)}.pdf`)).toHaveLength(200);
    expect([...normalizeFileName('dosya‮gpj.exe')].some((c) => c === '‮')).toBe(false);
  });

  it('ASCII yedek Türkçe harfleri dönüştürür, tırnak ve özel karakterleri _ yapar', () => {
    expect(asciiFallbackName('Çağrı Şikâyeti ıİöÖüÜğĞ.pdf')).toBe('Cagri Sik_yeti iIoOuUgG.pdf');
    expect(asciiFallbackName('a"b;c.pdf')).toBe('a_b_c.pdf');
  });

  it('Content-Disposition attachment; filename + filename* (yüzde kodlu) üretir', () => {
    const h = contentDisposition('Örnek Dilekçe (1).pdf');
    expect(h).toBe(
      `attachment; filename="Ornek Dilekce _1_.pdf"; filename*=UTF-8''%C3%96rnek%20Dilek%C3%A7e%20%281%29.pdf`,
    );
  });

  it('CR/LF ve tırnak başlık bölmeye yol açamaz', () => {
    const h = contentDisposition('x"\r\nSet-Cookie: a=b\n.pdf');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.split('"').length).toBe(3);
    expect(h).toContain("filename*=UTF-8''");
  });

  it('indirme adı en çok 150 karakter', () => {
    const h = contentDisposition(`${'a'.repeat(400)}.pdf`);
    const m = /filename="([^"]*)"/.exec(h);
    expect(m?.[1]?.length).toBe(150);
  });
});

describe('KK-P20-6 (KK-033-26): eşzamanlı yükleme slotları', () => {
  it('kullanıcı başına ve genel sınır aşılınca 429 QUOTA_CONCURRENCY_LIMIT; bırakınca açılır', () => {
    const slots = createUploadSlots({ perUser: 2, api: 3 });
    const r1 = slots.acquire('u1');
    slots.acquire('u1');
    expect(() => slots.acquire('u1')).toThrowError(
      expect.objectContaining({ code: 'QUOTA_CONCURRENCY_LIMIT' }),
    );
    slots.acquire('u2');
    expect(() => slots.acquire('u3')).toThrowError(
      expect.objectContaining({ code: 'QUOTA_CONCURRENCY_LIMIT' }),
    );
    r1();
    r1();
    expect(() => slots.acquire('u3')).not.toThrow();
  });
});
