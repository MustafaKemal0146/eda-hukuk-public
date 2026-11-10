// @tk TK-28
// Yönetim paneli şablon envanteri ve sentetik önizleme: her katalog şablonu önizlenir, çıktı düz metindir
// ve `renderEmail` düz metniyle aynı içeriği taşır (aynı içerik bloklarından üretilir).
import { describe, expect, it } from 'vitest';
import { type CatalogCode, SUBJECT_MAX_LENGTH, TEMPLATES } from '../src/catalog.ts';
import { emailTemplateInventory, previewEmail } from '../src/preview.ts';

const CODES = Object.keys(TEMPLATES) as CatalogCode[];

describe('KK-ADM-SBL-1: şablon envanteri', () => {
  it('her katalog şablonu envanterde; sürüm tarihi ve mühürlü sırlar işaretli', () => {
    const inv = emailTemplateInventory();
    expect(inv.map((i) => i.code).sort()).toEqual([...CODES].sort());
    for (const i of inv) {
      expect(i.version).toBe(TEMPLATES[i.code].version);
      expect(i.versionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const sealed = i.variables.filter((v) => v.sealed).map((v) => v.name);
      expect(sealed).toEqual([...TEMPLATES[i.code].secrets]);
    }
    const inv2 = inv.find((i) => i.code === 'factor_changed');
    expect(inv2?.variables.find((v) => v.name === 'factor')).toMatchObject({
      type: 'enum',
      options: ['totp', 'passkey'],
    });
    expect(inv2?.variables.find((v) => v.name === 'changedAt')?.type).toBe('datetime');
  });
});

describe('KK-ADM-SBL-2: sentetik önizleme', () => {
  it('her şablon için konu <= 78 ve düz metin üretilir; HTML ve gerçek adres yok', () => {
    for (const code of CODES) {
      const p = previewEmail(code);
      expect(p, code).not.toBeNull();
      expect(p?.subject.length ?? 0).toBeGreaterThan(0);
      expect(p?.subject.length ?? 0).toBeLessThanOrEqual(SUBJECT_MAX_LENGTH);
      expect(p?.text, code).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(p?.text, code).not.toContain('@');
      expect(p?.version).toBe(TEMPLATES[code].version);
    }
  });

  it('kataloğda olmayan kod için null', () => {
    expect(previewEmail('yok_boyle_sablon')).toBeNull();
    expect(previewEmail('email_change_confirm')).toBeNull();
  });
});
