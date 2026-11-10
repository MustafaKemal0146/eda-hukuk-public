// Uyuşmazlık Mahkemesi tablo satırı / belge başlığı → NormalizedDecision (021 §5.5, §5.7.3).
// canlı tablo bölüm, konu, sonuç ve özet vermez → `chamber`, `snippet`, `facets` null.
import type { NormalizedDecisionValue } from '@eda/contracts/mcp';
import { trDateToIso } from '../dates.ts';
import { canonNo, decisionTitle } from '../normalize-common.ts';
import { isValidUyusmazlikId, uyusmazlikPublicUrl } from './document-id.ts';
import type { UyusmazlikRow } from './parse.ts';

export const UYUSMAZLIK_COURT_NAME = 'Uyuşmazlık Mahkemesi';

export function normalizeUyusmazlikRow(
  row: UyusmazlikRow,
  retrievedAt: string,
): NormalizedDecisionValue | null {
  // Göreli yol: başında "./" veya "/" olabilir; kimlik her zaman önek dahil düz yoldur.
  const documentId = row.href.replace(/^\.?\//, '');
  if (!isValidUyusmazlikId(documentId)) return null;
  const esasNo = canonNo(row.esasNo);
  const kararNo = canonNo(row.kararNo);
  return {
    source: 'uyusmazlik',
    document_id: documentId,
    court_type: 'uyusmazlik',
    court: UYUSMAZLIK_COURT_NAME,
    chamber: null,
    chamber_code: null,
    esas_no: esasNo,
    karar_no: kararNo,
    decision_date: trDateToIso(row.kararTarihi),
    title: decisionTitle(UYUSMAZLIK_COURT_NAME, null, esasNo, kararNo),
    snippet: null,
    url: uyusmazlikPublicUrl(documentId),
    retrieved_at: retrievedAt,
    origin: 'live',
    facets: null,
  };
}

export type UyusmazlikDocMeta = {
  chamber: string | null;
  esasNo: string | null;
  kararNo: string | null;
  decisionDate: string | null;
};

const BOLUMLER: readonly [RegExp, string][] = [
  [/\bHUKUK BÖLÜMÜ\b/, 'Hukuk Bölümü'],
  [/\bCEZA BÖLÜMÜ\b/, 'Ceza Bölümü'],
  [/\bGENEL KURUL(U)?\b/, 'Genel Kurul'],
];

/** Karar metninin ilk satırlarından künye ("ESAS NO : …", "KARAR NO : …", "KARAR TR : …"). */
export function parseUyusmazlikHeader(text: string): UyusmazlikDocMeta {
  const head = text.slice(0, 2500);
  const esas = /ESAS\s+NO\s*:\s*(\d{4}\s*\/\s*\d{1,7})/.exec(head)?.[1] ?? null;
  const karar = /KARAR\s+NO\s*:\s*(\d{4}\s*\/\s*\d{1,7})/.exec(head)?.[1] ?? null;
  const date = /KARAR\s+(?:TR|TARİHİ)\s*:\s*(\d{2}[./]\d{2}[./]\d{4})/.exec(head)?.[1] ?? null;
  const chamber = BOLUMLER.find(([re]) => re.test(head))?.[1] ?? null;
  return {
    chamber,
    esasNo: canonNo(esas),
    kararNo: canonNo(karar),
    decisionDate: trDateToIso(date),
  };
}

/** PDF sayfa altlarındaki UYAP doğrulama satırı (erişim kodu) karar metnine ait değildir. */
export function stripUyapFooter(text: string): string {
  return text
    .replace(/UYAP Bilişim Sistemindeki bu dokümana[\s\S]{0,240}?ile erişebilirsiniz\.?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
