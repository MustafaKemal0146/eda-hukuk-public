// AYM kaydı → NormalizedDecision (021 §5.5). Norm: esas/karar no; bireysel: başvuru no `esas_no`'da
// (P11.10). Başvurucu adı (`basvuruAdi`) sonuca alınmaz; başlık sunucu tarafından künyeden üretilir.
import type { NormalizedDecisionValue } from '@eda/contracts/mcp';
import { isoDay } from '../dates.ts';
import { canonNo, decisionTitle, htmlSnippet } from '../normalize-common.ts';
import type { AymItemValue } from './client.ts';
import { AYM_COURT_NAME, type AymCourtType, courtTypeOfKararTipi } from './codes.ts';
import { anayasaDocumentId, anayasaPublicUrl } from './document-id.ts';

type Facets = NonNullable<NormalizedDecisionValue['facets']>;

/** Portal tarihi `YYYY-MM-DD` (veya ISO zaman damgası) → ISO gün; geçersizse null. */
export function aymDate(s: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(T|$)/.exec(s?.trim() ?? '');
  if (!m?.[1]) return null;
  const t = Date.parse(`${m[1]}T00:00:00Z`);
  return Number.isNaN(t) || isoDay(t) !== m[1] ? null : m[1];
}

const isoToTr = (iso: string): string => iso.split('-').reverse().join('.');

/** Karar künye numarası: norm için karar no, bireysel için başvuru no. */
export function aymNumber(courtType: AymCourtType, item: AymItemValue): string | null {
  return canonNo(courtType === 'aym_norm' ? item.kararNo : item.basvuruNo);
}

function pushFacet(
  out: Facets,
  key: Facets[number]['key'],
  value: string | null | undefined,
): void {
  const v = value?.replace(/\s+/g, ' ').trim();
  if (v) out.push({ key, value: v.slice(0, 300) });
}

function normFacets(item: AymItemValue): Facets {
  const out: Facets = [];
  pushFacet(out, 'inceleme_sonuc', item.kararTuruDosyaSonucuLabel);
  const maddeler = new Set<string>();
  const dayanak = new Set<string>();
  for (const g of item.normDenetimiIncelemeGerekceleri ?? []) {
    for (const m of g.maddeNumaralari ?? []) {
      if (!m.maddeNumarasi) continue;
      const fikra = m.fikra ? `/${m.fikra}` : '';
      const bent = m.bent ? `-${m.bent}` : '';
      const altBent = m.altBent ? `-${m.altBent}` : '';
      maddeler.add(`${m.maddeNumarasi}${fikra}${bent}${altBent}`);
    }
    for (const d of g.dayanakAnayasaHukumList ?? []) if (d.hukum) dayanak.add(d.hukum.trim());
  }
  pushFacet(out, 'madde', [...maddeler].join('; '));
  pushFacet(out, 'dayanak', [...dayanak].join('; '));
  return out;
}

function resmiGazete(item: AymItemValue): string | null {
  const date = aymDate(item.resmiGazeteTarihi);
  const no = item.resmiGazeteSayisi;
  if (!date && (no === null || no === undefined)) return null;
  return [date ? isoToTr(date) : null, no !== null && no !== undefined ? `${no}` : null]
    .filter((p): p is string => p !== null)
    .join(' - ');
}

export function aymFacets(courtType: AymCourtType, item: AymItemValue): Facets {
  const out: Facets =
    courtType === 'aym_norm'
      ? normFacets(item)
      : (() => {
          const f: Facets = [];
          pushFacet(f, 'basvuru_no', canonNo(item.basvuruNo));
          pushFacet(f, 'karar_turu', item.kararTuruBasvuruSonucuLabel);
          pushFacet(f, 'bolum', item.kararVerenBirimLabel);
          return f;
        })();
  pushFacet(out, 'resmi_gazete', resmiGazete(item));
  return out;
}

export function aymTitle(
  courtType: AymCourtType,
  chamber: string | null,
  esasNo: string | null,
  kararNo: string | null,
): string {
  if (courtType === 'aym_norm') return decisionTitle(AYM_COURT_NAME, null, esasNo, kararNo);
  return [AYM_COURT_NAME, chamber, esasNo ? `B. No: ${esasNo}` : null]
    .filter((p): p is string => p !== null && p !== '')
    .join(' ');
}

export function normalizeAymItem(
  item: AymItemValue,
  retrievedAt: string,
): NormalizedDecisionValue | null {
  const courtType = courtTypeOfKararTipi(item.kararTipi);
  if (!courtType) return null;
  const number = aymNumber(courtType, item);
  const documentId = anayasaDocumentId(courtType, number);
  if (!documentId || !number) return null;
  const chamber = courtType === 'aym_bireysel' ? item.kararVerenBirimLabel?.trim() || null : null;
  const esasNo = courtType === 'aym_norm' ? canonNo(item.esasNo) : number;
  const kararNo = courtType === 'aym_norm' ? number : null;
  const facets = aymFacets(courtType, item);
  return {
    source: 'anayasa',
    document_id: documentId,
    court_type: courtType,
    court: AYM_COURT_NAME,
    chamber,
    chamber_code: null,
    esas_no: esasNo,
    karar_no: kararNo,
    decision_date: aymDate(item.kararTarihi),
    title: aymTitle(courtType, chamber, esasNo, kararNo),
    snippet: htmlSnippet(item.kararKonusu),
    url: anayasaPublicUrl({ courtType, number }),
    retrieved_at: retrievedAt,
    origin: 'live',
    facets: facets.length > 0 ? facets : null,
  };
}
