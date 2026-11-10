// @tk TK-16
// Zorunlu unsur denetimi (054 §4.4; 080 §3, §4; KK-080-2, KK-080-3). Hukuk onayı bekliyor.
import {
  ELEMENT_ROLES,
  PETITION_ELEMENT_MATRIX,
  PETITION_SUBTYPES,
} from '@eda/contracts/legal/petition-types';
import { describe, expect, it } from 'vitest';
import { checkElements } from '../../src/validate/elements.ts';
import { doc, fixture, heading, type Json, list, para, pm, section, text } from '../helpers.ts';

const full = (): Json => fixture('petition-full.json');

/** petition-full içinden bir rolün bölümünü verilen içerikle değiştirir. */
function withRole(role: string, content: Json[] | null): Json {
  const d = full() as { content: Json[] };
  const content2 = d.content.flatMap((s) => {
    const attrs = s.attrs as { role: string; blockId: string };
    if (attrs.role !== role) return [s];
    return content === null ? [] : [section(attrs.blockId, role, ...content)];
  });
  return { ...d, content: content2 };
}

const run = (json: Json, subtype: string | null, caseTypeCode?: string) =>
  checkElements(pm(json), 'petition', subtype, { caseTypeCode: caseTypeCode ?? null });

describe('KK-P17a-5 KK-080-3: checkElements altın vakaları', () => {
  it('tam dilekçe (claim) uyarısız', () => {
    expect(run(full(), 'claim')).toEqual([]);
  });

  it('(a) boş numberedExplanations -> elements.numberedExplanations warn', () => {
    const issues = run(withRole('numberedExplanations', [heading('AÇIKLAMALAR'), para()]), 'claim');
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ['elements.numberedExplanations', 'warn'],
    ]);
    expect(issues[0]?.blockId).toBe('b-PF0004');
  });

  it('(b) claim: boş evidenceList -> info (tavan)', () => {
    const issues = run(withRole('evidenceList', [heading('DELİLLER'), para()]), 'claim');
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['elements.evidenceList', 'info']]);
    const absent = run(withRole('evidenceList', null), 'claim');
    expect(absent.map((i) => [i.code, i.severity, i.blockId])).toEqual([
      ['elements.evidenceList', 'info', null],
    ]);
  });

  it('(c) answer: boş evidenceList -> info', () => {
    const issues = run(withRole('evidenceList', [heading('DELİLLER'), para()]), 'answer');
    expect(issues.find((i) => i.code === 'elements.evidenceList')?.severity).toBe('info');
  });

  it('(d) elements.claimValue yalnız claim ve yalnız DAVA DEĞERİ yokken info', () => {
    const noValue = withRole('subjectLine', [para(text('KONU\t: Örnek konu.'))]);
    expect(run(noValue, 'claim').map((i) => [i.code, i.severity])).toEqual([
      ['elements.claimValue', 'info'],
    ]);
    expect(run(full(), 'claim').map((i) => i.code)).not.toContain('elements.claimValue');
    expect(run(noValue, 'appeal_regional').map((i) => i.code)).not.toContain('elements.claimValue');
  });

  it('(e) hiçbir unsur kodu block üretmez (her alt tür, boş belge)', () => {
    const empty = doc(section('b-0000A1', 'generic', para()));
    for (const subtype of [...PETITION_SUBTYPES, null]) {
      const issues = checkElements(pm(empty), 'petition', subtype, {
        caseTypeCode: 'consumer',
      });
      expect(issues.length).toBeGreaterThan(0);
      for (const i of issues) expect(['warn', 'info']).toContain(i.severity);
    }
  });

  it('partiesGrid: yer tutucu duruyorsa eksik sayılır; courtHeader yalnız yer tutucu', () => {
    const ph = withRole('partiesGrid', [para(text('DAVACI\t: [[Doldurulacak: ad soyad]]'))]);
    expect(run(ph, 'claim').map((i) => i.code)).toEqual(['elements.partiesGrid']);
    const ch = withRole('courtHeader', [para(text('[[Doldurulacak: mahkeme]]'))]);
    expect(run(ch, 'claim').map((i) => i.code)).toEqual(['elements.courtHeader']);
  });

  it('K hücresi boşsa info, Z hücresi boşsa warn (excuse: partiesGrid K)', () => {
    const noParties = withRole('partiesGrid', null);
    expect(run(noParties, 'excuse').find((i) => i.code === 'elements.partiesGrid')?.severity).toBe(
      'info',
    );
    expect(run(noParties, 'claim').find((i) => i.code === 'elements.partiesGrid')?.severity).toBe(
      'warn',
    );
  });

  it('elements.fileNo: answer ve courtHeader dosya no taşımıyorsa info', () => {
    const noFile = withRole('courtHeader', [para(text('ÖRNEK MAHKEMESİ’NE'))]);
    expect(run(noFile, 'answer').map((i) => i.code)).toContain('elements.fileNo');
    expect(run(full(), 'answer').map((i) => i.code)).not.toContain('elements.fileNo');
    expect(run(noFile, 'claim').map((i) => i.code)).not.toContain('elements.fileNo');
  });

  it('elements.mediationRecord: yalnız kapsamdaki dava türünde, EKLER ve arabuluculuk yokken', () => {
    const noAttachments = withRole('generic', null);
    expect(run(noAttachments, 'claim', 'consumer').map((i) => i.code)).toContain(
      'elements.mediationRecord',
    );
    expect(run(noAttachments, 'claim', 'admin_annulment').map((i) => i.code)).not.toContain(
      'elements.mediationRecord',
    );
    expect(run(full(), 'claim', 'consumer').map((i) => i.code)).not.toContain(
      'elements.mediationRecord',
    );
    const mention = withRole('generic', [
      heading('BAŞKA'),
      list(true, 'Arabuluculuk son tutanağı.'),
    ]);
    expect(run(mention, 'claim', 'consumer').map((i) => i.code)).not.toContain(
      'elements.mediationRecord',
    );
  });
});

describe('KK-P17a-5 KK-080-2: matris tamlığı ve boş türler', () => {
  it('KK-080-2: 19 x 8 hücrenin her biri checkElements ile tutarlı düzey üretir', () => {
    const empty = doc(section('b-0000A1', 'generic', para()));
    for (const subtype of PETITION_SUBTYPES) {
      const issues = checkElements(pm(empty), 'petition', subtype);
      for (const role of ELEMENT_ROLES) {
        const cell = PETITION_ELEMENT_MATRIX[subtype][role];
        const got = issues.find((i) => i.code === `elements.${role}`)?.severity ?? null;
        const capped = role === 'legalGrounds' || role === 'evidenceList';
        const expected = cell === 'Y' ? null : capped ? 'info' : cell === 'Z' ? 'warn' : 'info';
        expect(got, `${subtype}.${role}`).toBe(expected);
      }
    }
  });

  it('KK-080-2: notice, memo, free için boş dizi', () => {
    const empty = pm(doc(section('b-0000A1', 'generic', para())));
    expect(checkElements(empty, 'notice', 'notice_general')).toEqual([]);
    expect(checkElements(empty, 'memo', 'memo_legal_opinion')).toEqual([]);
    expect(checkElements(empty, 'free', 'free_blank')).toEqual([]);
    expect(checkElements(pm(fixture('notice-generic.json')), 'notice', null)).toEqual([]);
  });

  it('alt türsüz dilekçede başlangıç kümesi (tüm roller), bilgi kontrolleri yok', () => {
    const issues = checkElements(pm(doc(section('b-0000A1', 'generic', para()))), 'petition', null);
    expect(issues.map((i) => i.code)).toEqual(ELEMENT_ROLES.map((r) => `elements.${r}`));
  });
});
