// @tk TK-28
// KK-053-11-4 (Kullanıcılar): süzgeç -> arama gövdesi, limit formu doğrulaması, rol-eylem kuralı ve
// metin kataloğu kapsamı (modül ekranında kullanılan her kapalı küme değerinin Türkçe karşılığı vardır).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_ROLES, USER_SUSPEND_REASONS, VERIFICATION_STATUSES } from '@eda/contracts/enums';
import { describe, expect, it } from 'vitest';
import { navFor } from '../src/features/shell/nav.ts';
import {
  accountTone,
  canActOn,
  draftFromOverrides,
  EMPTY_FILTERS,
  isAllNull,
  isQueryTooShort,
  LIMIT_FIELDS,
  parseLimitDraft,
  searchBody,
  usagePercent,
  verificationTone,
} from '../src/features/users/users-model.ts';

const messages = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'messages', 'tr.json'), 'utf8'),
) as { users: Record<string, Record<string, string>>; nav: Record<string, string> };

const EMPTY = { chatTurnsPerDay: '', chatTurnsPerMonth: '', tokensPerDay: '', tokensPerMonth: '' };

describe('KK-053-11-4: kullanıcılar menü ve arama gövdesi', () => {
  it('Kullanıcılar menüsü support ve super_admin için görünür', () => {
    expect(navFor('super_admin').map((n) => n.key)).toContain('users');
    expect(navFor('support').map((n) => n.key)).toContain('users');
  });

  it('boş süzgeç boş gövde üretir; arama metni gövdeye girer, URL’ye değil', () => {
    expect(searchBody(EMPTY_FILTERS)).toEqual({});
    expect(
      searchBody(
        {
          query: '  ayse@ornek.test ',
          accountStatus: 'suspended',
          platformRole: 'user',
          verificationStatus: 'verified',
        },
        'imlec',
      ),
    ).toEqual({
      query: 'ayse@ornek.test',
      accountStatus: 'suspended',
      platformRole: 'user',
      verificationStatus: 'verified',
      cursor: 'imlec',
    });
  });

  it('tek karakterlik arama gönderilmez ve uyarılır', () => {
    expect(searchBody({ ...EMPTY_FILTERS, query: 'a' })).toEqual({});
    expect(isQueryTooShort('a')).toBe(true);
    expect(isQueryTooShort('')).toBe(false);
    expect(isQueryTooShort('ab')).toBe(false);
  });
});

describe('KK-053-11-4: kullanıcı limit formu', () => {
  it('boş alanlar null (varsayılan zincir); tümü boşsa sıfırlama', () => {
    const r = parseLimitDraft(EMPTY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(isAllNull(r.value)).toBe(true);
  });

  it('geçerli değerler tam sayıya çevrilir; sıfır geçerlidir', () => {
    const r = parseLimitDraft({ ...EMPTY, chatTurnsPerDay: '50', tokensPerMonth: '0' });
    expect(r).toEqual({
      ok: true,
      value: {
        chatTurnsPerDay: 50,
        chatTurnsPerMonth: null,
        tokensPerDay: null,
        tokensPerMonth: 0,
      },
    });
  });

  it('negatif, ondalık, harf ve üst sınır aşımı reddedilir ve alanı bildirir', () => {
    expect(parseLimitDraft({ ...EMPTY, chatTurnsPerDay: '-1' })).toEqual({
      ok: false,
      field: 'chatTurnsPerDay',
    });
    expect(parseLimitDraft({ ...EMPTY, tokensPerDay: '1.5' })).toEqual({
      ok: false,
      field: 'tokensPerDay',
    });
    expect(parseLimitDraft({ ...EMPTY, chatTurnsPerMonth: 'on' })).toEqual({
      ok: false,
      field: 'chatTurnsPerMonth',
    });
    expect(parseLimitDraft({ ...EMPTY, chatTurnsPerDay: '2000000' })).toEqual({
      ok: false,
      field: 'chatTurnsPerDay',
    });
  });

  it('mevcut geçersiz kılmalar forma geri yazılır', () => {
    expect(
      draftFromOverrides({
        chatTurnsPerDay: 10,
        chatTurnsPerMonth: null,
        tokensPerDay: null,
        tokensPerMonth: 5000,
      }),
    ).toEqual({
      chatTurnsPerDay: '10',
      chatTurnsPerMonth: '',
      tokensPerDay: '',
      tokensPerMonth: '5000',
    });
  });

  it('kullanım oranı sınırsız veya sıfır limitte yok; üst sınır yüzde 100', () => {
    expect(usagePercent(5, null)).toBeNull();
    expect(usagePercent(5, 0)).toBeNull();
    expect(usagePercent(5, 10)).toBe(50);
    expect(usagePercent(50, 10)).toBe(100);
  });
});

describe('KK-053-11-10: eylem kuralları ve metin katalogu', () => {
  it('yalnız super_admin ve yalnız user rolündeki hesap üzerinde eylem; personel satırı eylemsiz', () => {
    expect(canActOn('super_admin', 'user')).toBe(true);
    expect(canActOn('support', 'user')).toBe(false);
    expect(canActOn('super_admin', 'support')).toBe(false);
    expect(canActOn('super_admin', 'super_admin')).toBe(false);
  });

  it('durum tonları', () => {
    expect(accountTone('suspended')).toBe('danger');
    expect(accountTone('active')).toBe('success');
    expect(verificationTone('verified')).toBe('success');
    expect(verificationTone('pending_verification')).toBe('warning');
    expect(verificationTone('rejected')).toBe('danger');
  });

  it('kapalı küme değerlerinin Türkçe karşılığı katalogda vardır', () => {
    const u = messages.users;
    for (const r of USER_SUSPEND_REASONS) expect(u.reason?.[r], r).toBeTruthy();
    for (const s of VERIFICATION_STATUSES) expect(u.verification?.[s], s).toBeTruthy();
    for (const r of PLATFORM_ROLES) expect(u.role?.[r], r).toBeTruthy();
    for (const f of LIMIT_FIELDS) expect(u.limit?.[f], f).toBeTruthy();
    expect(messages.nav.users).toBe('Kullanıcılar');
  });
});
