// get_decision (021 §5.4, §5.8): belge → Markdown/metin → rol etiketli bölümler. Tam metin yalnız süreç
// içi belge tamponunda tutulur (≤ docLruTtlSec); aynı belgenin bölüm istekleri portala yeniden gitmez.
// Kaynaklar: bedesten (JSON içinde base64 HTML/PDF), anayasa (JSON `icerik` HTML), uyusmazlik (PDF).
import { createHash } from 'node:crypto';
import type {
  McpDecisionSectionValue,
  McpGetDecisionArgs,
  McpGetDecisionResult,
  McpPriority,
  NormalizedDecisionValue,
} from '@eda/contracts/mcp';
import { type SectionProfile, splitDecisionSections } from '@eda/legal/sections';
import { type AymItemValue, aymSearch } from '../sources/anayasa/client.ts';
import { AYM_COURT_NAME, AYM_KINDS } from '../sources/anayasa/codes.ts';
import {
  type AymDocRef,
  anayasaPublicUrl,
  parseAnayasaId,
} from '../sources/anayasa/document-id.ts';
import { aymDate, aymNumber, aymTitle, normalizeAymItem } from '../sources/anayasa/normalize.ts';
import { chamberCodeOf } from '../sources/bedesten/chambers.ts';
import { bedestenGetDocument } from '../sources/bedesten/client.ts';
import { bedestenPublicUrl, isValidBedestenId } from '../sources/bedesten/document-id.ts';
import { parseDocHeader } from '../sources/bedesten/normalize.ts';
import { isoDay } from '../sources/dates.ts';
import { SourceError, validationFailed } from '../sources/errors.ts';
import { decisionTitle } from '../sources/normalize-common.ts';
import { uyusmazlikGetDocument } from '../sources/uyusmazlik/client.ts';
import {
  esasFromDocId,
  isValidUyusmazlikId,
  uyusmazlikPublicUrl,
} from '../sources/uyusmazlik/document-id.ts';
import {
  parseUyusmazlikHeader,
  stripUyapFooter,
  UYUSMAZLIK_COURT_NAME,
} from '../sources/uyusmazlik/normalize.ts';
import { capSections } from '../transform/cap-sections.ts';
import { decodeHtml, htmlToMarkdown, pdfToText } from '../transform/convert.ts';
import { type CallCtx, DECISION_META_TTL_MS, type DecisionDoc, type ToolDeps } from './context.ts';

type RawDecision =
  | { mimeType: 'text/html' | 'application/pdf'; bytes: Uint8Array }
  | { mimeType: 'text/html'; html: string };

/** Ham belge → normalize metin (+ kaynağa özgü temizlik); sınır aşımında kesilir. */
async function toDecisionDoc(
  deps: ToolDeps,
  raw: RawDecision,
  cleanup: (text: string) => string,
): Promise<DecisionDoc> {
  let text: string;
  let textStatus: DecisionDoc['textStatus'] = 'ok';
  if ('html' in raw) {
    text = htmlToMarkdown(raw.html);
  } else if (raw.mimeType === 'application/pdf') {
    const pdf = await pdfToText(raw.bytes);
    text = pdf.text;
    textStatus = pdf.status;
  } else {
    text = htmlToMarkdown(decodeHtml(raw.bytes));
  }
  text = cleanup(text);
  if (text.length === 0) textStatus = 'text_unavailable';
  const truncated = text.length > deps.cfg.maxDocChars;
  if (truncated) text = text.slice(0, deps.cfg.maxDocChars);
  return { kind: 'decision', mimeType: raw.mimeType, textStatus, text, truncated };
}

/** Tampon → tek uçuş → portal. `key` = `<kaynak>:<document_id>`. */
async function loadDoc(
  deps: ToolDeps,
  source: McpGetDecisionArgs['source'],
  key: string,
  fetchRaw: () => Promise<RawDecision>,
  cleanup: (text: string) => string = (t) => t,
): Promise<{ doc: DecisionDoc; cached: boolean }> {
  const hit = deps.docBuffer.get(key, deps.now());
  if (hit && hit.value.kind === 'decision') {
    deps.gateway.metricsOf(source).record(deps.now(), 'cache_hit');
    return { doc: hit.value, cached: true };
  }
  const doc = await deps.flights.run(`doc:${key}`, async () => {
    const value = await toDecisionDoc(deps, await fetchRaw(), cleanup);
    const ttl = deps.cfg.docLruTtlSec * 1000;
    deps.docBuffer.set(key, value, deps.now(), ttl, ttl, value.text.length * 2);
    return value;
  });
  return { doc, cached: false };
}

/** Bedesten belgesi (P11 dikey dilim; çağıranlar için dışa açık). */
export function loadDecisionDoc(
  deps: ToolDeps,
  documentId: string,
  priority: McpPriority,
): Promise<{ doc: DecisionDoc; cached: boolean }> {
  return loadDoc(deps, 'bedesten', `bedesten:${documentId}`, () =>
    bedestenGetDocument(deps.gateway, documentId, priority),
  );
}

type DecisionHead = Pick<
  McpGetDecisionResult,
  | 'court_type'
  | 'court'
  | 'chamber'
  | 'chamber_code'
  | 'esas_no'
  | 'karar_no'
  | 'decision_date'
  | 'title'
>;

const headOf = (m: NormalizedDecisionValue): DecisionHead => ({
  court_type: m.court_type,
  court: m.court,
  chamber: m.chamber,
  chamber_code: m.chamber_code,
  esas_no: m.esas_no,
  karar_no: m.karar_no,
  decision_date: m.decision_date,
  title: m.title,
});

const SECTION_PROFILES: Record<McpGetDecisionArgs['source'], SectionProfile> = {
  bedesten: 'default',
  anayasa: 'aym',
  uyusmazlik: 'uyusmazlik',
};

function buildResult(
  deps: ToolDeps,
  args: McpGetDecisionArgs,
  loaded: { doc: DecisionDoc; cached: boolean },
  head: DecisionHead,
  url: string,
  warnings: McpGetDecisionResult['warnings'],
): McpGetDecisionResult {
  const { doc, cached } = loaded;
  const sections =
    doc.textStatus === 'ok'
      ? capSections(
          splitDecisionSections(doc.text, SECTION_PROFILES[args.source]),
          deps.cfg.decisionSectionMaxChars,
        )
      : [];
  if (args.section !== null && args.section > sections.length) {
    throw validationFailed('invalid_arguments', args.source);
  }
  const out: McpDecisionSectionValue[] = sections.map((s, i) => ({
    no: i + 1,
    role: s.role,
    chars: s.text.length,
    markdown: args.section === null || args.section === i + 1 ? s.text : null,
  }));
  return {
    source: args.source,
    document_id: args.document_id,
    ...head,
    url,
    retrieved_at: isoDay(deps.now()),
    mime_type: doc.mimeType,
    text_status: doc.textStatus,
    total_sections: sections.length,
    total_chars: doc.text.length,
    content_sha256:
      doc.textStatus === 'ok' ? createHash('sha256').update(doc.text).digest('hex') : null,
    sections: out,
    cached,
    warnings: doc.truncated ? ['truncated_max_chars', ...warnings] : warnings,
  };
}

async function getBedestenDecision(
  deps: ToolDeps,
  args: McpGetDecisionArgs,
  ctx: CallCtx,
): Promise<McpGetDecisionResult> {
  // SSRF savunması: kimlik doğrulanmadan hiçbir istek atılmaz (KK-021-11).
  if (!isValidBedestenId(args.document_id))
    throw validationFailed('invalid_document_id', 'bedesten');
  const url = bedestenPublicUrl(args.document_id);
  const loaded = await loadDecisionDoc(deps, args.document_id, ctx.priority);
  const warnings: McpGetDecisionResult['warnings'] = [];
  const seen = deps.decisionMeta.get(`bedesten:${args.document_id}`, deps.now())?.value;
  const header = parseDocHeader(loaded.doc.text);
  // AS-P11-13: belge yanıtı künye taşımaz; aramada görülmemiş belgede künye başlıktan sezilir,
  // tür sezilemezse `yargitay` varsayılır ve `metadata_partial` uyarısı verilir.
  if (!seen && (header.courtType === null || header.esasNo === null)) {
    warnings.push('metadata_partial');
  }
  const head: DecisionHead = seen
    ? headOf(seen)
    : {
        court_type: header.courtType ?? 'yargitay',
        court: header.court,
        chamber: header.chamber,
        chamber_code: header.courtType ? chamberCodeOf(header.courtType, header.chamber) : null,
        esas_no: header.esasNo,
        karar_no: header.kararNo,
        decision_date: header.decisionDate,
        title: null,
      };
  return buildResult(deps, args, loaded, head, url, warnings);
}

/** AYM kalıcı numarasından portal kaydını bulur (norm: karar no, bireysel: başvuru no; tam eşitlik). */
async function resolveAymItem(
  deps: ToolDeps,
  ref: AymDocRef,
  priority: McpPriority,
): Promise<AymItemValue> {
  const kind = AYM_KINDS[ref.courtType];
  const res = await aymSearch(
    deps.gateway,
    kind.host,
    {
      kararTipi: kind.kararTipi,
      ...(ref.courtType === 'aym_norm' ? { kararNo: ref.number } : { basvuruNo: ref.number }),
      page: '0',
      size: '5',
    },
    priority,
    'doc',
  );
  const matches = res.items
    .filter((it) => it.kararTipi === kind.kararTipi && aymNumber(ref.courtType, it) === ref.number)
    // Aynı başvuruda birden çok karar varsa en yenisi (portalın kendi çözümleyicisiyle aynı seçim).
    .sort((a, b) => (aymDate(b.kararTarihi) ?? '').localeCompare(aymDate(a.kararTarihi) ?? ''));
  const first = matches[0];
  if (!first) throw new SourceError('SOURCE_DOCUMENT_NOT_FOUND', null, { source: 'anayasa' });
  return first;
}

async function getAnayasaDecision(
  deps: ToolDeps,
  args: McpGetDecisionArgs,
  ctx: CallCtx,
): Promise<McpGetDecisionResult> {
  const ref = parseAnayasaId(args.document_id);
  if (!ref) throw validationFailed('invalid_document_id', 'anayasa');
  const url = anayasaPublicUrl(ref);
  const key = `anayasa:${args.document_id}`;
  const kind = AYM_KINDS[ref.courtType];
  const loaded = await loadDoc(deps, 'anayasa', key, async () => {
    const t = deps.now();
    const portalId =
      deps.portalRefs.get(key, t)?.value ?? (await resolveAymItem(deps, ref, ctx.priority)).id;
    const res = await aymSearch(
      deps.gateway,
      kind.host,
      { kararTipi: kind.kararTipi, id: portalId, size: '1' },
      ctx.priority,
      'doc',
    );
    const item = res.items.find((it) => it.id === portalId);
    if (!item) throw new SourceError('SOURCE_DOCUMENT_NOT_FOUND', null, { source: 'anayasa' });
    const meta = normalizeAymItem(item, isoDay(deps.now()));
    if (meta && meta.document_id === args.document_id) {
      deps.decisionMeta.set(key, meta, deps.now(), DECISION_META_TTL_MS, DECISION_META_TTL_MS);
    }
    deps.portalRefs.set(key, portalId, deps.now(), DECISION_META_TTL_MS, DECISION_META_TTL_MS);
    return { mimeType: 'text/html', html: item.icerik ?? '' };
  });
  const seen = deps.decisionMeta.get(key, deps.now())?.value;
  const fallbackNo = ref.number;
  const head: DecisionHead = seen
    ? headOf(seen)
    : {
        court_type: ref.courtType,
        court: AYM_COURT_NAME,
        chamber: null,
        chamber_code: null,
        esas_no: ref.courtType === 'aym_bireysel' ? fallbackNo : null,
        karar_no: ref.courtType === 'aym_norm' ? fallbackNo : null,
        decision_date: null,
        title: aymTitle(
          ref.courtType,
          null,
          ref.courtType === 'aym_bireysel' ? fallbackNo : null,
          ref.courtType === 'aym_norm' ? fallbackNo : null,
        ),
      };
  return buildResult(deps, args, loaded, head, url, seen ? [] : ['metadata_partial']);
}

async function getUyusmazlikDecision(
  deps: ToolDeps,
  args: McpGetDecisionArgs,
  ctx: CallCtx,
): Promise<McpGetDecisionResult> {
  if (!isValidUyusmazlikId(args.document_id)) {
    throw validationFailed('invalid_document_id', 'uyusmazlik');
  }
  const url = uyusmazlikPublicUrl(args.document_id);
  const key = `uyusmazlik:${args.document_id}`;
  const loaded = await loadDoc(
    deps,
    'uyusmazlik',
    key,
    () => uyusmazlikGetDocument(deps.gateway, args.document_id, ctx.priority),
    stripUyapFooter,
  );
  const seen = deps.decisionMeta.get(key, deps.now())?.value;
  const header = parseUyusmazlikHeader(loaded.doc.text);
  const esasNo = seen?.esas_no ?? header.esasNo ?? esasFromDocId(args.document_id);
  const kararNo = seen?.karar_no ?? header.kararNo;
  const chamber = seen?.chamber ?? header.chamber;
  const warnings: McpGetDecisionResult['warnings'] =
    !seen && (header.esasNo === null || header.kararNo === null) ? ['metadata_partial'] : [];
  const head: DecisionHead = {
    court_type: 'uyusmazlik',
    court: UYUSMAZLIK_COURT_NAME,
    chamber,
    chamber_code: null,
    esas_no: esasNo,
    karar_no: kararNo,
    decision_date: seen?.decision_date ?? header.decisionDate,
    title: decisionTitle(UYUSMAZLIK_COURT_NAME, chamber, esasNo, kararNo),
  };
  return buildResult(deps, args, loaded, head, url, warnings);
}

export async function getDecision(
  deps: ToolDeps,
  args: McpGetDecisionArgs,
  ctx: CallCtx,
): Promise<McpGetDecisionResult> {
  if (!deps.enabled.has(args.source)) {
    throw new SourceError('SOURCE_NOT_IN_COVERAGE', 'source_disabled', { source: args.source });
  }
  switch (args.source) {
    case 'bedesten':
      return getBedestenDecision(deps, args, ctx);
    case 'anayasa':
      return getAnayasaDecision(deps, args, ctx);
    case 'uyusmazlik':
      return getUyusmazlikDecision(deps, args, ctx);
  }
}
