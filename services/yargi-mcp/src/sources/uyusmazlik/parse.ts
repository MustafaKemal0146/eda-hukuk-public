// Uyuşmazlık Mahkemesi karar arama sayfası ayrıştırıcısı. Canlı biçim (2026-10-10): ASP.NET
// WebForms; gizli alanlar `__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION`; sonuç tablosu
// `table#GridView1` (sütunlar: esas no, karar no, karar tarihi, "Görüntüle" PDF bağlantısı); toplam
// `span#lblSearchStatus` ("Arama sonuçları: N dosya bulundu."). AS-P11-08: cheerio yok; seçiciler dar
// düzenli ifadelerle uygulanır, beklenen öğe yoksa çağıran `parse_error` üretir.

export type UyusmazlikFormTokens = {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
};

export type UyusmazlikRow = {
  esasNo: string;
  kararNo: string;
  kararTarihi: string;
  href: string;
};

export type UyusmazlikPage = { total: number | null; rows: UyusmazlikRow[] };

function hiddenValue(html: string, id: string): string | null {
  const tag = new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0];
  if (!tag) return null;
  return /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? null;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? '');
}

const stripTags = (s: string): string =>
  decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Gizli form alanları; biri eksikse null. */
export function parseFormTokens(html: string): UyusmazlikFormTokens | null {
  const viewState = hiddenValue(html, '__VIEWSTATE');
  const viewStateGenerator = hiddenValue(html, '__VIEWSTATEGENERATOR');
  const eventValidation = hiddenValue(html, '__EVENTVALIDATION');
  if (!viewState || !viewStateGenerator || !eventValidation) return null;
  return {
    viewState: decodeEntities(viewState),
    viewStateGenerator: decodeEntities(viewStateGenerator),
    eventValidation: decodeEntities(eventValidation),
  };
}

const ROW =
  /<tr(?:\s[^>]*)?>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;

const EMPTY_STATUS = /bulunamad|sonuç yok/i;

/** Arama sonuç sayfası. Durum etiketi yoksa (beklenmeyen sayfa) null. */
export function parseSearchPage(html: string): UyusmazlikPage | null {
  const status = /<span[^>]*\bid="lblSearchStatus"[^>]*>([\s\S]*?)<\/span>/.exec(html);
  if (!status) return null;
  const statusText = stripTags(status[1] ?? '');
  const totalMatch = /(\d[\d.]*)\s+dosya bulundu/i.exec(statusText);
  const total = totalMatch?.[1] ? Number(totalMatch[1].replace(/\./g, '')) : null;
  const gridStart = html.indexOf('id="GridView1"');
  const rows: UyusmazlikRow[] = [];
  if (gridStart >= 0) {
    const grid = html.slice(gridStart);
    for (const m of grid.matchAll(ROW)) {
      const href = /href='([^']*)'|href="([^"]*)"/.exec(m[4] ?? '');
      const link = decodeEntities(href?.[1] ?? href?.[2] ?? '').trim();
      rows.push({
        esasNo: stripTags(m[1] ?? ''),
        kararNo: stripTags(m[2] ?? ''),
        kararTarihi: stripTags(m[3] ?? ''),
        href: link,
      });
    }
  }
  if (total !== null) return { total, rows };
  if (EMPTY_STATUS.test(statusText)) return { total: 0, rows: [] };
  // Durum metni boş: arama yapılmamış ilk sayfa (son kararlar listesi) veya biçim değişikliği. Bu
  // tablo sorgunun sonucu değildir; çağıran parse_error üretir.
  return null;
}
