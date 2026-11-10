// Güvenli bağlantı izin listesi (053-02 §5.3; 002 §3 `egress-portal` MVP alan adları). Model
// çıktısındaki ve kaynak kaydındaki bağlantılar yalnız bu resmî alan adlarında tıklanabilir;
// diğerleri düz metin kalır. Yalnız https; kullanıcı adı/parola içeren URL reddedilir.

const EXACT_HOSTS = new Set([
  'bedesten.adalet.gov.tr',
  'mevzuat.adalet.gov.tr',
  'www.mevzuat.gov.tr',
  'mevzuat.gov.tr',
  'kararlar.uyusmazlik.gov.tr',
]);

/** Anayasa Mahkemesi bilgi bankaları alt alan adlarıdır (normkararlarbilgibankasi, kararlarbilgibankasi). */
const SUFFIX_HOSTS = ['.anayasa.gov.tr'];

export function safeHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  if (url.port !== '' && url.port !== '443') return null;
  const host = url.hostname;
  const allowed = EXACT_HOSTS.has(host) || SUFFIX_HOSTS.some((s) => host.endsWith(s));
  return allowed ? url.toString() : null;
}
