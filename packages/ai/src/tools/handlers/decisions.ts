// search_decisions ve get_decision işleyicileri (021 §4.3-§4.4). Dilimde yerel korpus yok: her arama
// canlıdır (yargi-mcp → Bedesten); bütçe 021 §4.12 (tur başı canlı arama/getirme).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { effectiveCourtTypes, pickLiveSource } from '@eda/contracts/scope';
import type { CourtType, GetDecisionInput, SearchDecisionsInput } from '@eda/contracts/tools';
import {
  type DecisionHit,
  fetchedAtNow,
  rememberQuoteText,
  SourceError,
  type ToolContext,
} from '../context.ts';
import { decisionLongKunye, decisionShortKunye, isoToTr } from '../kunye.ts';
import { liveSearchLabel, PORTAL_LABELS } from '../labels.ts';
import { TOOL_MESSAGES } from '../messages.ts';
import { EXCERPT_MAX_CHARS, truncateToTokens, wrapSource } from '../serialize.ts';
import type { ToolOutcome } from './types.ts';

const trToIso = (d: string | null): string | null => {
  if (!d) return null;
  const [g, a, y] = d.split('.');
  return `${y}-${a}-${g}`;
};

function sourceError(e: unknown): ToolOutcome {
  if (e instanceof SourceError) {
    if (e.code === 'SOURCE_BUSY' || e.code === 'SOURCE_RATE_LIMITED') {
      return { text: TOOL_MESSAGES.busy, isError: false, notice: 'source_busy' };
    }
    if (e.code === 'SOURCE_DOCUMENT_NOT_FOUND') {
      return { text: 'Hata: Karar metni resmî kaynakta bulunamadı.', isError: true };
    }
    return { text: TOOL_MESSAGES.unavailable, isError: false, notice: 'source_unavailable' };
  }
  throw e;
}

type ReadSection = { role: string; markdown: string | null; chars: number };

/** Numara ile erişimde sorgu metni kaynakta kullanılmaz; MCP sözleşmesi (≥ 2 karakter) için yer tutucu. */
const BY_NUMBER_QUERY = 'karar';

/** Daire kodunun ait olduğu mahkeme (ChamberCode kümesi): kapsam listesi daireyle uyumlu türlere indirilir. */
function chamberCourtTypes(chamber: string | null): readonly CourtType[] | null {
  if (chamber === null) return null;
  if (/^(H\d+|C\d+|HGK|CGK|BGK|HBK|CBK|IBK)$/.test(chamber)) return ['yargitay', 'kyb'];
  if (/^(D\d+|DBGK|IDDK|VDDK|IIK|DBK)$/.test(chamber)) return ['danistay'];
  return null;
}

const squash = (t: string): string => t.replace(/\s+/g, ' ').trim();
const clip = (t: string, max: number): string =>
  t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

/** Kararın getirilen tüm bölümlerinin metni (alıntı denetimi için tam metin). */
function fullDecisionText(sections: readonly ReadSection[]): string {
  return sections
    .map((s) => s.markdown ?? '')
    .filter((t) => t.trim() !== '')
    .join('\n\n');
}

/** Okunan karar metninden kısa özüt: hüküm + gerekçenin başı (yoksa en kapsamlı bölüm). Yalnız metinden. */
function decisionDigest(sections: readonly ReadSection[]): string | null {
  const total = Math.floor(CONFIG_DEFAULTS['sources.decisionSectionMaxChars'] / 6);
  const text = (role: string): string => {
    const sec = sections.find((s) => s.role === role && (s.markdown ?? '').trim() !== '');
    return sec?.markdown ? squash(sec.markdown) : '';
  };
  const hukum = text('hukum');
  const gerekce = text('gerekce');
  const parts: string[] = [];
  if (gerekce)
    parts.push(`Gerekçe (başı): ${clip(gerekce, hukum ? Math.floor(total * 0.6) : total)}`);
  if (hukum) parts.push(`Hüküm: ${clip(hukum, gerekce ? Math.floor(total * 0.4) : total)}`);
  if (parts.length === 0) {
    const rest = [...sections]
      .filter((s) => s.role !== 'kunye' && (s.markdown ?? '').trim() !== '')
      .sort((a, b) => b.chars - a.chars)[0];
    if (!rest?.markdown) return null;
    parts.push(`Metin (başı): ${clip(squash(rest.markdown), total)}`);
  }
  return parts.join('\n');
}

/**
 * İlk karar(lar)ın metnini sunucu tarafında okur (#59): model özet göremediği için "okunmadı" demek
 * yerine bulguyu anlatabilsin. Model çağrı hakkı harcanmaz; en çok `sources.turnMaxLiveFetches` karar,
 * art arda (kaynak kovası için). Başarısız okuma sessizce atlanır; sonuç yine künyeli listedir.
 */
async function readTopDecisions(
  ctx: ToolContext,
  hits: readonly DecisionHit[],
  signal: AbortSignal,
  fullTexts: Map<string, string>,
): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  const max = CONFIG_DEFAULTS['sources.turnMaxLiveFetches'];
  for (const h of hits) {
    if (digests.size >= max || signal.aborted) break;
    if (h.snippet) continue;
    try {
      const doc = await ctx.backend.getDecision(h.source, h.document_id, null, signal);
      if (doc.text_status !== 'ok') continue;
      // Bölüm null ile istendiği için tüm bölümler metinlidir: alıntı denetimi tam metinle yapılır.
      fullTexts.set(`${h.source}:${h.document_id}`, fullDecisionText(doc.sections));
      const digest = decisionDigest(doc.sections);
      if (digest) digests.set(`${h.source}:${h.document_id}`, digest);
    } catch {
      // Kaynak yoğun veya erişilemez: özüt olmadan devam.
    }
  }
  return digests;
}

export async function searchDecisions(
  ctx: ToolContext,
  input: SearchDecisionsInput,
  callId: string,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  if (ctx.budget.liveSearches <= 0) {
    return {
      text: 'Not: Bu tur için canlı arama hakkı kullanıldı; elinizdeki kaynaklarla yanıtlayın.',
      isError: false,
      refundCall: true,
    };
  }
  // Kullanıcı kapsamı (P12 K5) modelin istediği türleri keser; tek canlı kaynak seçilir (K7).
  // Daire verilmişse kapsam listesi o dairenin mahkemesine indirilir: "Yargıtay 3. HD" için kapsamda
  // Danıştay da seçiliyken kaynak daire/tür uyumsuzluğu hatası vermesin.
  const scoped = effectiveCourtTypes(ctx.scope, input.court_types);
  const byChamber = chamberCourtTypes(input.chamber);
  const allowed =
    scoped !== null && byChamber !== null ? scoped.filter((c) => byChamber.includes(c)) : scoped;
  if (allowed !== null && allowed.length === 0) {
    return { text: TOOL_MESSAGES.outOfScopeDecisions, isError: false, detail: 'kapsam dışı' };
  }
  const live = pickLiveSource(allowed);
  ctx.budget.liveSearches -= 1;
  // Token ayıklama (strip_tokens) maskeleme adaptöründe yapılır; burada ikinci dönüşüm yok (026 §9.6).
  // Numara ile erişimde (esas_no / karar_no) sorgu metni kaynakta kullanılmaz; boşsa yer tutucu gider.
  const byNumber = input.esas_no !== null || input.karar_no !== null;
  const query = byNumber && !/\p{L}/u.test(input.query) ? BY_NUMBER_QUERY : input.query;
  ctx.emit({
    type: 'pipeline',
    data: {
      stage: 'live_queue',
      status: 'progress',
      label: liveSearchLabel([live.source]),
      toolName: 'search_decisions',
      callId,
    },
  });
  const request = {
    source: live.source,
    query,
    courtTypes: live.courtTypes,
    chamber: input.chamber,
    dateFrom: trToIso(input.date_from),
    dateTo: trToIso(input.date_to),
    esasNo: input.esas_no,
    kararNo: input.karar_no,
    page: input.page ?? 1,
  };
  let res: Awaited<ReturnType<ToolContext['backend']['searchDecisions']>>;
  let numberFallback = false;
  try {
    res = await ctx.backend.searchDecisions(request, signal);
    // Esas + karar birlikte eşleşmediyse (biri yanlış yazılmış olabilir) bir kez yalnız esas ile
    // denenir; sonuç "tahmini eşleme" notuyla verilir. Model çağrı hakkı harcanmaz.
    if (res.results.length === 0 && input.esas_no !== null && input.karar_no !== null) {
      res = await ctx.backend.searchDecisions({ ...request, kararNo: null }, signal);
      numberFallback = res.results.length > 0;
    }
  } catch (e) {
    return sourceError(e);
  }
  const hits = res.results.slice(0, CONFIG_DEFAULTS['retrieval.maxDecisionsToLlm']);
  if (hits.length === 0)
    return { text: TOOL_MESSAGES.noDecision, isError: false, detail: '0 karar' };
  // Etiketler okumadan ÖNCE ayrılır: paralel çağrılarda [K#] sırası okuma süresine bağlı olmaz.
  const records = hits.map((h, i) => {
    const rec = ctx.refs.allocate(`${h.source}:${h.document_id}`, (ref) => ({
      ref,
      kind: 'decision',
      sourceKey: `${h.source}:${h.document_id}`,
      sourceId: `${h.source}:${h.document_id}`,
      shortKunye: decisionShortKunye(h),
      title: decisionLongKunye(h),
      portal: h.source,
      url: h.url,
      retrievedAt: h.retrieved_at,
      fetchedAt: fetchedAtNow(ctx),
      relevance: i < 2 ? 'high' : 'medium',
      decision: h,
    }));
    ctx.turnRefs.add(rec.ref);
    return rec;
  });
  const fullTexts = new Map<string, string>();
  const digests = await readTopDecisions(ctx, hits, signal, fullTexts);
  const blocks = hits.map((h, i) => {
    const rec = records[i];
    if (!rec) throw new Error('karar kaydı eksik');
    // Modele okunan metin olarak verilen özüt, önizleme vurgusu için kayda yazılır (#58).
    const read = digests.get(`${h.source}:${h.document_id}`);
    if (read) rec.excerpt = read.slice(0, EXCERPT_MAX_CHARS);
    const header = `${decisionLongKunye(h)} | Canlı: ${PORTAL_LABELS[h.source]} (${isoToTr(h.retrieved_at)})`;
    const digest = digests.get(`${h.source}:${h.document_id}`);
    // Alıntı denetimi tur belleği (025 §6.5): modele verilen özet/özüt ve okunan tam metin.
    rememberQuoteText(ctx, rec.ref, h.snippet, false);
    rememberQuoteText(ctx, rec.ref, digest, false);
    rememberQuoteText(ctx, rec.ref, fullTexts.get(`${h.source}:${h.document_id}`), true);
    const body =
      h.snippet ??
      (digest
        ? `Okunan metinden (kaynak metin):\n${digest}`
        : 'Özet yok; metin için get_decision ile bu etiketi getir.');
    return wrapSource(rec.ref, 'karar', header, body);
  });
  ctx.emit({ type: 'sources', turnRefs: [...ctx.turnRefs] });
  const more = res.hasMore
    ? '\nDaha fazla sonuç var: page ile sonraki sayfayı isteyebilirsin.'
    : '';
  const stale = res.stale ? '\nNot: Canlı sonuçlar önbellekten.' : '';
  const fallback = numberFallback
    ? `\nNot: Esas ${input.esas_no} ve karar ${input.karar_no} birlikte eşleşmedi; yalnız esas numarasıyla bulunan karar(lar) listelendi. Karar numarasının kullanıcının verdiğiyle örtüşüp örtüşmediğini belirt.`
    : '';
  const read =
    digests.size > 0
      ? `\nNot: ${digests.size} kararın metni okundu ("Okunan metinden" bölümleri). Bulguları bu kaynaklardan, [K#] etiketiyle anlat; okunmayan kararları "metni okunmadı, kaynak panelinden açılabilir" diye belirt.`
      : '';
  return {
    text: `${blocks.join('\n')}${read}${fallback}${more}${stale}`,
    isError: false,
    detail: `${hits.length} karar`,
  };
}

type Section = { no: number; role: string; chars: number; markdown: string | null };

/** En uzun içerikli bölüm (künye hariç): eski biçimli kararlarda gerekçe çoğu kez tek blok hâlindedir. */
const largest = (sections: Section[]): Section | undefined =>
  [...sections].filter((s) => s.role !== 'kunye').sort((a, b) => b.chars - a.chars)[0] ??
  sections[0];

function pickSection(
  doc: { sections: Section[] },
  input: GetDecisionInput,
): { section: Section | undefined; note: string | null } {
  if (input.section !== null) {
    return { section: doc.sections.find((s) => s.no === input.section), note: null };
  }
  if (input.role !== null) {
    const byRole = doc.sections.find((s) => s.role === input.role);
    if (byRole) return { section: byRole, note: null };
    return {
      section: largest(doc.sections),
      note: `Not: Bu kararda '${input.role}' rolüyle ayrılmış bölüm yok; metnin en kapsamlı bölümü gösteriliyor.`,
    };
  }
  // Varsayılan: ilk gerekçe bölümü, yoksa en kapsamlı bölüm (021 §4.4).
  const gerekce = doc.sections.find((s) => s.role === 'gerekce');
  return { section: gerekce ?? largest(doc.sections), note: null };
}

export async function getDecision(
  ctx: ToolContext,
  input: GetDecisionInput,
  callId: string,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const rec = ctx.refs.byRef(input.ref);
  if (!rec) return { text: TOOL_MESSAGES.unknownRef(input.ref), isError: true };
  if (rec.kind !== 'decision' || !rec.decision) {
    return { text: TOOL_MESSAGES.wrongKindLegislation(input.ref), isError: true };
  }
  const hit: DecisionHit = rec.decision;
  ctx.emit({
    type: 'pipeline',
    data: {
      stage: 'tool',
      status: 'progress',
      label: 'Emsal karar analiz ediliyor',
      toolName: 'get_decision',
      callId,
      detail: decisionLongKunye(hit),
    },
  });
  if (ctx.budget.liveFetches <= 0) {
    return { text: 'Not: Bu tur için karar getirme hakkı kullanıldı.', isError: false };
  }
  ctx.budget.liveFetches -= 1;
  let doc: Awaited<ReturnType<ToolContext['backend']['getDecision']>>;
  try {
    doc = await ctx.backend.getDecision(hit.source, hit.document_id, null, signal);
  } catch (e) {
    return sourceError(e);
  }
  ctx.turnRefs.add(rec.ref);
  if (doc.text_status !== 'ok' || doc.sections.length === 0) {
    ctx.emit({ type: 'sources', turnRefs: [...ctx.turnRefs] });
    return {
      text: `Bu kararın metni çıkarılamadı; resmî portalda açılabilir.`,
      isError: false,
      detail: decisionLongKunye(hit),
    };
  }
  if (input.section !== null && input.section > doc.total_sections) {
    return { text: TOOL_MESSAGES.sectionOut(doc.total_sections), isError: true };
  }
  const { section: sec, note } = pickSection(doc, input);
  const max = CONFIG_DEFAULTS['sources.decisionSectionMaxChars'];
  const raw = sec?.markdown ?? '';
  const body =
    raw.length > max
      ? truncateToTokens(raw, Math.floor(max / 3), `…[kısaltıldı; devamı için section=${sec?.no}]`)
      : raw;
  rec.excerpt = body.slice(0, EXCERPT_MAX_CHARS);
  // Bölüm null ile istendi: tüm bölümler metinlidir; alıntı denetimi kararın tam metniyle yapılır.
  rememberQuoteText(ctx, rec.ref, fullDecisionText(doc.sections), true);
  ctx.emit({ type: 'sources', turnRefs: [...ctx.turnRefs] });
  const header = `${decisionLongKunye(hit)} | Canlı: ${PORTAL_LABELS[hit.source]} (${isoToTr(doc.retrieved_at)})\nBölüm ${sec?.no}/${doc.total_sections} — ${sec?.role}`;
  const index = doc.sections.map((s) => `${s.no} ${s.role}`).join(' · ');
  return {
    text: `${wrapSource(rec.ref, 'karar', header, body)}\nBölüm listesi: ${index}${note ? `\n${note}` : ''}`,
    isError: false,
    detail: decisionLongKunye(hit),
  };
}
