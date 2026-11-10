// @tk TK-16
// Kök düzen öznitelikleri (yazı tipi, punto, satır aralığı): varsayılanlar, doğrulama (geçersiz değer
// `schema.attr_invalid`), taslak JSON'unda korunma ve `docLayoutOf` geri dönüşü.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOC_LAYOUT,
  DOC_FONT_SIZES,
  DOC_FONTS,
  DOC_LINE_HEIGHTS,
  docLayoutOf,
} from '../../src/schema/document.ts';
import { getEditorSchema } from '../../src/schema/get-schema.ts';
import { parseDocJson } from '../../src/schema/parse-doc.ts';
import { doc, para, section, text } from '../helpers.ts';

const base = () => doc(section('b-7Q2K9D', 'generic', para(text('Metin'))));

describe('KK-STUDYO-F: belge düzeni kök öznitelikleri', () => {
  it('öznitelik verilmezse varsayılan düzen (Times New Roman 12 pt, 1,5)', () => {
    const parsed = parseDocJson(base());
    expect(parsed.issues).toEqual([]);
    expect(docLayoutOf(parsed.doc?.attrs)).toEqual(DEFAULT_DOC_LAYOUT);
    expect(getEditorSchema().topNodeType.spec.attrs?.fontFamily?.default).toBe('times-new-roman');
  });

  it('geçerli değerler JSON gidiş-dönüşte korunur', () => {
    const json = { ...base(), attrs: { fontFamily: 'arial', fontSizePt: 11, lineHeight: 1.15 } };
    const parsed = parseDocJson(json);
    expect(parsed.issues).toEqual([]);
    expect(parsed.doc?.toJSON()).toMatchObject({ attrs: json.attrs });
    expect(docLayoutOf(parsed.doc?.attrs)).toEqual(json.attrs);
  });

  it('listede olmayan değer şema hatasıdır; docLayoutOf geçersizi varsayılana çeker', () => {
    const bad = { ...base(), attrs: { fontFamily: 'Comic Sans', fontSizePt: 14, lineHeight: 2 } };
    const codes = parseDocJson(bad).issues.map((i) => `${i.code}@${i.path}`);
    expect(codes).toContain('schema.attr_invalid@.attrs.fontFamily');
    expect(codes).toContain('schema.attr_invalid@.attrs.fontSizePt');
    expect(codes).toContain('schema.attr_invalid@.attrs.lineHeight');
    expect(docLayoutOf(bad.attrs)).toEqual(DEFAULT_DOC_LAYOUT);
    expect(DOC_FONTS).toContain(DEFAULT_DOC_LAYOUT.fontFamily);
    expect(DOC_FONT_SIZES).toEqual([11, 12, 13]);
    expect(DOC_LINE_HEIGHTS).toEqual([1, 1.15, 1.5]);
  });
});
