// Uyuşmazlık Mahkemesi belge kimliği (021 §5.6): portal tablosundaki göreli PDF yolu (ör.
// `Uploads/2026-206.pdf`). : canlı portalda tek yol öneki `Uploads/` ve uzantı `.pdf` gözlendi;
// kimlik bu dar kalıba uymazsa (yol ayırıcı, `..`, kaçış, sorgu dizesi, şema) istek atılmadan reddedilir.
export const UYUSMAZLIK_HOST = 'kararlar.uyusmazlik.gov.tr';
export const UYUSMAZLIK_BASE = `https://${UYUSMAZLIK_HOST}`;
export const UYUSMAZLIK_DOC_PATH_PREFIXES = ['Uploads/'] as const;

const DOC_ID = /^Uploads\/[A-Za-z0-9][A-Za-z0-9_-]{0,150}\.(pdf|PDF)$/;

export function isValidUyusmazlikId(id: string): boolean {
  return DOC_ID.test(id) && UYUSMAZLIK_DOC_PATH_PREFIXES.some((p) => id.startsWith(p));
}

export function uyusmazlikPublicUrl(id: string): string {
  if (!isValidUyusmazlikId(id)) throw new Error('belge kimliği geçersiz');
  const url = new URL(`${UYUSMAZLIK_BASE}/${id}`);
  if (url.host !== UYUSMAZLIK_HOST || url.pathname !== `/${id}` || url.search !== '') {
    throw new Error('belge kimliği geçersiz');
  }
  return url.toString();
}

/** Dosya adındaki esas numarası (`Uploads/2026-206.pdf` → `2026/206`); arama künyesi yoksa yedek. */
export function esasFromDocId(id: string): string | null {
  const m = /^Uploads\/(\d{4})-0*([1-9]\d{0,6})\.(pdf|PDF)$/.exec(id);
  return m?.[1] && m[2] ? `${m[1]}/${m[2]}` : null;
}
