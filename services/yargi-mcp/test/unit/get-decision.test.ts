// @tk TK-28
// KK-021-11 (SSRF), KK-021-16 (metinsiz PDF), KK-021-17 (belge tamponu): get_decision içerik dönüşümü ve
// bölümleme. HTML kaydı resmî (portalda anonimleştirilmiş); PDF'ler sentetiktir.
import { McpGetDecisionSuccess } from '@eda/contracts/mcp';
import { splitDecisionSections } from '@eda/legal/sections';
import { describe, expect, it } from 'vitest';
import { getDecision } from '../../src/tools/get-decision.ts';
import { capSections } from '../../src/transform/cap-sections.ts';
import { CTX, json, makeDeps, replay, scripted, syntheticPdf } from '../helpers.ts';

const ARGS = { source: 'bedesten' as const, document_id: '979779300', section: null };

describe('get_decision: HTML → Markdown ve bölümler (kayıtlı belge)', () => {
  it('künye, istem, taraf iddiası, gerekçe, hüküm sırasıyla bölümlenir; şemaya uyar', async () => {
    const deps = makeDeps({ transport: replay().transport });
    const out = await getDecision(deps, ARGS, CTX);
    expect(McpGetDecisionSuccess.parse(out)).toBeTruthy();
    expect(out.mime_type).toBe('text/html');
    expect(out.text_status).toBe('ok');
    const roles = out.sections.map((s) => s.role);
    expect(roles[0]).toBe('kunye');
    for (const r of ['istem', 'taraf_iddiasi', 'gerekce', 'hukum'] as const)
      expect(roles).toContain(r);
    expect(roles.at(-1)).toBe('hukum');
    // Künye belge başlığından: arama görülmemiş olsa da daire ve esas/karar no çıkarılır.
    expect([out.court_type, out.chamber, out.chamber_code, out.esas_no, out.karar_no]).toEqual([
      'yargitay',
      '3. Hukuk Dairesi',
      'H3',
      '2022/8302',
      '2023/167',
    ]);
    const all = out.sections.map((s) => s.markdown).join('\n');
    expect(all).not.toMatch(/<\/?(p|font|br|b|html)\b/i);
    expect(out.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.total_chars).toBeGreaterThan(5000);
  });

  it('section verilirse yalnız o bölümün metni döner; sınır dışı bölüm VALIDATION_FAILED', async () => {
    const deps = makeDeps({ transport: replay().transport });
    const out = await getDecision(deps, { ...ARGS, section: 2 }, CTX);
    expect(out.sections.filter((s) => s.markdown !== null).map((s) => s.no)).toEqual([2]);
    await expect(getDecision(deps, { ...ARGS, section: 99 }, CTX)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      reason: 'invalid_arguments',
    });
  });

  it('KK-021-17: aynı belgenin ikinci isteği portala gitmez (tampon isabeti)', async () => {
    const t = replay();
    const deps = makeDeps({ transport: t.transport });
    await getDecision(deps, ARGS, CTX);
    const again = await getDecision(deps, { ...ARGS, section: 1 }, CTX);
    expect(again.cached).toBe(true);
    expect(t.calls).toHaveLength(1);
  });

  it('bulunamayan belge SOURCE_DOCUMENT_NOT_FOUND', async () => {
    const deps = makeDeps({ transport: replay().transport });
    await expect(
      getDecision(deps, { ...ARGS, document_id: '99999999999' }, CTX),
    ).rejects.toMatchObject({ code: 'SOURCE_DOCUMENT_NOT_FOUND' });
  });
});

describe('KK-021-11: SSRF yük listesi istek atılmadan reddedilir', () => {
  const payloads = [
    'http://169.254.169.254/ND/1',
    'ND/2019/1/../../x',
    '%2e%2e/',
    'BB/2019/1?x=',
    '\\\\host',
    '979779300/../1',
    '９７９７７９３００',
    '979779300 ',
  ];
  for (const id of payloads) {
    it(`${JSON.stringify(id)} → VALIDATION_FAILED / invalid_document_id`, async () => {
      const t = replay();
      const deps = makeDeps({ transport: t.transport });
      await expect(getDecision(deps, { ...ARGS, document_id: id }, CTX)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        reason: 'invalid_document_id',
      });
      expect(t.calls).toHaveLength(0);
    });
  }
});

describe('KK-021-16: PDF dönüşümü (sentetik PDF)', () => {
  const pdfDoc = (bytes: Uint8Array) =>
    scripted(() =>
      json({
        data: { content: Buffer.from(bytes).toString('base64'), mimeType: 'application/pdf' },
        metadata: { FMTY: 'SUCCESS', FMC: 'ADALET_SUCCESS' },
      }),
    );

  it('metin katmanlı PDF unpdf ile metne çevrilir', async () => {
    const lines = [
      '9. Hukuk Dairesi 2024/1 E. , 2024/2 K.',
      'I. DAVA',
      ...Array.from(
        { length: 6 },
        (_, i) => `Sentetik test paragrafi ${i + 1}: davaci alacak talep etmistir.`,
      ),
      'VI. KARAR',
      'Aciklanan sebeplerle onanmasina karar verildi.',
    ];
    const t = pdfDoc(syntheticPdf(lines));
    const out = await getDecision(makeDeps({ transport: t.transport }), ARGS, CTX);
    expect(out.mime_type).toBe('application/pdf');
    expect(out.text_status).toBe('ok');
    expect(out.sections.map((s) => s.markdown).join('\n')).toContain('Sentetik test paragrafi 3');
  });

  it('metin katmanı olmayan PDF text_unavailable; başka hosta istek yok', async () => {
    const t = pdfDoc(syntheticPdf([]));
    const out = await getDecision(makeDeps({ transport: t.transport }), ARGS, CTX);
    expect([out.text_status, out.total_sections, out.content_sha256]).toEqual([
      'text_unavailable',
      0,
      null,
    ]);
    expect(t.calls.map((c) => new URL(c.url).host)).toEqual(['bedesten.adalet.gov.tr']);
  });
});

describe('Bölüm üst sınırı (capSections)', () => {
  it('6000 karakteri aşan bölüm paragraf sınırında, aynı rolle bölünür', () => {
    const para = 'a'.repeat(2500);
    const text = `GEREKÇE\n\n${[para, para, para, para].join('\n\n')}`;
    const capped = capSections(splitDecisionSections(text), 6000);
    expect(capped.length).toBeGreaterThan(1);
    expect(capped.every((s) => s.role === 'gerekce' && s.text.length <= 6000)).toBe(true);
  });
});
