// İstemci IP'si (040 §5.7): Caddy `trusted_proxies` tanımsız olduğundan gelen `X-Forwarded-For`u
// atar ve yerine doğrudan bağlantı adresini yazar (caddy v2.11.7 ile elle doğrulandı; Caddyfile'da
// `trusted_proxies` ve `header_up X-Forwarded-For` bulunmadığı `test/net.test.ts` ile korunur). Yine de
// başlıkta birden çok öğe varsa istemcinin eklediği ilk öğelere DEĞİL, en yakın vekilin (Caddy)
// eklediği SON öğeye güvenilir; böylece vekil zinciri yanlışlıkla değişirse sahte başlıkla hız
// sınırı kovası seçilemez. Başlık yoksa bilinmeyen. Oturum ve denetimde IP son oktet kısaltılmış
// yazılır (042 §2.5; 002 §22).

export const UNKNOWN_IP = '0.0.0.0';

export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff === null) return UNKNOWN_IP;
  const parts = xff
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  return parts.at(-1) ?? UNKNOWN_IP;
}

/** IPv6 adresini 8 onaltılı bloğa açar (`::` sıkıştırması, gömülü IPv4); geçersizse null. */
export function expandIpv6(ip: string): number[] | null {
  let s = ip.trim().toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4 !== null) {
    const o = v4.slice(1, 5).map(Number);
    if (o.some((n) => n > 255)) return null;
    const hi = ((o[0] ?? 0) << 8) | (o[1] ?? 0);
    const lo = ((o[2] ?? 0) << 8) | (o[3] ?? 0);
    s = `${s.slice(0, v4.index)}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toBlocks = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const h of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(Number.parseInt(h, 16));
    }
    return out;
  };
  const head = toBlocks(halves[0] ?? '');
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toBlocks(halves[1] ?? '');
  if (tail === null || head.length + tail.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

/**
 * Hız sınırı kovası için IP: IPv4 olduğu gibi, IPv6 /64 öneki (bir /64 içinde 2^64 adres vardır;
 * adres başına kova saldırgana sınırsız kova verir). IPv4'e eşlenmiş IPv6 (`::ffff:a.b.c.d`) IPv4
 * sayılır. Çözümlenemeyen değer olduğu gibi döner.
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(':')) return ip;
  const blocks = expandIpv6(ip);
  if (blocks === null) return ip;
  if (blocks.slice(0, 5).every((b) => b === 0) && blocks[5] === 0xffff) {
    const hi = blocks[6] ?? 0;
    const lo = blocks[7] ?? 0;
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${blocks
    .slice(0, 4)
    .map((b) => b.toString(16))
    .join(':')}::/64`;
}

/** IPv4 son okteti 0, IPv6 /64 sonrası sıfır (kaba gösterim). */
export function truncateIp(ip: string | null | undefined): string | null {
  if (ip === null || ip === undefined || ip === '') return null;
  if (ip.includes(':')) {
    const head = ip.split(':').slice(0, 4).join(':');
    return `${head}::`;
  }
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0` : null;
}
