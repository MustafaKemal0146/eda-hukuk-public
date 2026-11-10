// Giriş sonrası dönüş adresi (053-01 §3.6): yalnız uygulama içi, tek eğik çizgiyle başlayan,
// sorgu/parça içermeyen yollar kabul edilir; aksi hâlde `/sohbet`.
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9/_-]*$/;
export const DEFAULT_NEXT = '/sohbet';

export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > 200 || !SAFE_PATH.test(raw)) return DEFAULT_NEXT;
  return raw;
}
