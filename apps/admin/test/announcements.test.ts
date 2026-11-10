// @tk TK-28
// P27 duyuru modülü (yönetim web): form -> sözleşme dönüşümü, tarih yardımcıları, menü rolleri, katalog.
//  KK-P27-ANN-A1 form doğrulaması   KK-P27-ANN-A2 kısmi güncelleme   KK-P27-ANN-A3 menü ve katalog
import {
  type AdminAnnouncementDtoValue,
  ANNOUNCEMENT_STATES,
} from '@eda/contracts/api/admin-announcements';
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_SEVERITIES,
  NOTIFICATION_TYPES,
} from '@eda/contracts/enums';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json' with { type: 'json' };
import {
  EMPTY_FORM,
  formFrom,
  isoToLocal,
  lastDays,
  localToIso,
  readRate,
  toCreateInput,
  toUpdateInput,
} from '../src/features/announcements/announcements-model.ts';
import { navFor } from '../src/features/shell/nav.ts';

const valid = { ...EMPTY_FORM, title: 'Planlı bakım', body: 'Cumartesi gece kısa kesinti olacak.' };

const current: AdminAnnouncementDtoValue = {
  id: '0198a000-0000-7000-8000-000000000001',
  severity: 'info',
  audience: 'all',
  title: 'Planlı bakım',
  body: 'Cumartesi gece kısa kesinti olacak.',
  activeFrom: '2026-10-16T08:00:00.000Z',
  activeUntil: null,
  state: 'active',
  createdAt: '2026-10-16T08:00:00.000Z',
  updatedAt: '2026-10-16T08:00:00.000Z',
};

describe('KK-P27-ANN-A1: form doğrulaması', () => {
  it('geçerli form sözleşmeye dönüşür; boş tarihler gönderilmez', () => {
    const r = toCreateInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ severity: 'info', audience: 'all', title: 'Planlı bakım' });
      expect(r.value.activeFrom).toBeUndefined();
      expect(r.value.activeUntil).toBeUndefined();
    }
  });

  it('boş başlık, HTML ve ters aralık ilgili alanı işaretler', () => {
    expect(toCreateInput({ ...valid, title: '  ' })).toEqual({ ok: false, field: 'title' });
    expect(toCreateInput({ ...valid, body: 'x <b>kalın</b>' })).toEqual({
      ok: false,
      field: 'body',
    });
    expect(
      toCreateInput({ ...valid, activeFrom: '2026-10-20T10:00', activeUntil: '2026-10-20T09:00' }),
    ).toEqual({ ok: false, field: 'activeUntil' });
    expect(toCreateInput({ ...valid, activeFrom: 'dün' })).toEqual({
      ok: false,
      field: 'activeFrom',
    });
  });

  it('yerel tarih gidiş-dönüş', () => {
    const iso = localToIso('2026-10-20T10:30');
    expect(typeof iso).toBe('string');
    expect(isoToLocal(iso as string)).toBe('2026-10-20T10:30');
    expect(localToIso('')).toBeNull();
    expect(localToIso('x')).toBeUndefined();
    expect(isoToLocal(null)).toBe('');
  });
});

describe('KK-P27-ANN-A2: kısmi güncelleme', () => {
  it('yalnız değişen alanlar gider; değişiklik yoksa reddedilir; bitiş boşaltılırsa null', () => {
    const f = formFrom(current);
    expect(toUpdateInput(f, current)).toEqual({ ok: false, field: 'title' });
    const r = toUpdateInput({ ...f, severity: 'critical' }, current);
    expect(r).toEqual({ ok: true, value: { severity: 'critical' } });
    const withEnd = { ...current, activeUntil: '2026-10-30T08:00:00.000Z' };
    const cleared = toUpdateInput({ ...formFrom(withEnd), activeUntil: '' }, withEnd);
    expect(cleared).toEqual({ ok: true, value: { activeUntil: null } });
  });
});

describe('KK-P27-ANN-A3: menü, yardımcılar ve katalog', () => {
  it('Duyurular menüsünü support da görür (salt okur)', () => {
    expect(navFor('support').map((n) => n.key)).toContain('announcements');
    expect(navFor('super_admin').map((n) => n.key)).toContain('announcements');
  });

  it('özet aralığı bugün dahil ve oran yuvarlanır', () => {
    expect(lastDays(30, new Date(2026, 9, 16))).toEqual({ from: '2026-09-17', to: '2026-10-16' });
    expect(readRate(0, 0)).toBeNull();
    expect(readRate(3, 1)).toBe(33);
    expect(readRate(2, 5)).toBe(100);
  });

  it('metin kataloğu düzey, hedef, durum ve bildirim türlerini kapsar', () => {
    const a = tr.announcements;
    for (const s of ANNOUNCEMENT_SEVERITIES) expect(a.severity[s], s).toBeTruthy();
    for (const s of ANNOUNCEMENT_AUDIENCES) expect(a.audience[s], s).toBeTruthy();
    for (const s of ANNOUNCEMENT_STATES) expect(a.state[s], s).toBeTruthy();
    for (const s of NOTIFICATION_TYPES) expect(a.notificationType[s], s).toBeTruthy();
    expect(tr.nav.announcements).toBe('Duyurular');
  });
});
