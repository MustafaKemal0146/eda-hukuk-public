// @tk TK-04
// İstemci IP'si ve hız sınırı kovası (O-4, KK-042-17): `X-Forwarded-For` en yakın vekilin (Caddy)
// yazdığı SON öğeden okunur; IPv6 /64 kovasına indirilir; Caddyfile gelen başlığa güvenmez.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clientIp, expandIpv6, ipBucket, UNKNOWN_IP } from '../src/auth/net.ts';
import { ipPrefix } from '../src/middleware/rate-limit.ts';

const h = (v?: string) => new Headers(v === undefined ? {} : { 'x-forwarded-for': v });

describe('KK-042-17 (O-4): istemci IP ve kova', () => {
  it('clientIp: tek öğe, sahte önek eklenmiş zincirde SON öğe, başlıksız bilinmeyen', () => {
    expect(clientIp(h('203.0.113.9'))).toBe('203.0.113.9');
    // İstemci sahte "1.2.3.4" ekler; Caddy gerçek bağlantı adresini sona yazar.
    expect(clientIp(h('1.2.3.4, 203.0.113.9'))).toBe('203.0.113.9');
    expect(clientIp(h('  1.2.3.4 ,  , 203.0.113.9  '))).toBe('203.0.113.9');
    expect(clientIp(h())).toBe(UNKNOWN_IP);
    expect(clientIp(h(''))).toBe(UNKNOWN_IP);
  });

  it('expandIpv6: sıkıştırma, gömülü IPv4 ve geçersiz girdi', () => {
    expect(expandIpv6('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(expandIpv6('::ffff:203.0.113.9')).toEqual([0, 0, 0, 0, 0, 0xffff, 0xcb00, 0x7109]);
    expect(expandIpv6('2001:db8::1::2')).toBeNull();
    expect(expandIpv6('2001:db8:zz::1')).toBeNull();
    expect(expandIpv6('1:2:3:4:5:6:7:8:9')).toBeNull();
  });

  it('ipBucket: IPv4 aynen; IPv6 /64 (kısaltma biçimi fark etmez); eşlenmiş IPv4 IPv4 sayılır', () => {
    expect(ipBucket('203.0.113.9')).toBe('203.0.113.9');
    const a = ipBucket('2001:db8:1:2::1');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe(a);
    expect(ipBucket('2001:db8:1:2:aaaa::9')).toBe(a);
    expect(ipBucket('2001:db8:1:3::1')).not.toBe(a);
    expect(ipBucket('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('ipPrefix (hesap+IP sayacı): IPv4 /24, IPv6 /64 (kısaltılmış adres dahil)', () => {
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0');
    expect(ipPrefix('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2');
    expect(ipPrefix('2001:db8:1:2::9')).toBe('2001:db8:1:2');
    expect(ipPrefix('2001:db8::1')).toBe('2001:db8:0:0');
    expect(ipPrefix('::ffff:203.0.113.77')).toBe('203.0.113.0');
  });

  it('Caddyfile: gelen X-Forwarded-For korunmaz (trusted_proxies ve header_up yok)', () => {
    // caddy v2.11.7 ile elle doğrulandı: trusted_proxies yokken istemcinin "X-Forwarded-For: 1.2.3.4,
    // 5.6.7.8" başlığı atılır ve upstream yalnız bağlantı adresini görür. Bu denetim, yapılandırmanın
    // bu davranışı bozacak biçimde değişmesini yakalar (örn. Cloudflare önüne alınırsa `clientIp`
    // ve hız sınırı kovaları yeniden tasarlanmalıdır).
    const text = readFileSync(join(import.meta.dirname, '../../../infra/caddy/Caddyfile'), 'utf8');
    const code = text
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/trusted_proxies/i);
    expect(code).not.toMatch(/header_up\s+X-Forwarded-For/i);
    expect(code).not.toMatch(/client_ip_headers/i);
  });
});
