// @tk TK-03
// P27 duyuru sözleşmeleri: düz metin kuralı, tarih aralığı, kısmi güncelleme, sıkı şema.
//  KK-P27-ANN-C1 düz metin   KK-P27-ANN-C2 aralık ve alanlar   KK-P27-ANN-C3 uygulama DTO
import { describe, expect, it } from 'vitest';
import {
  AdminNotificationSummaryResponse,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from '../src/api/admin-announcements.ts';
import { AnnouncementDto } from '../src/api/announcements.ts';

const base = { severity: 'info', title: 'Başlık', body: 'Düz metin.' };

describe('KK-P27-ANN-C1: düz metin', () => {
  it('HTML etiketi ve denetim karakteri reddedilir; karşılaştırma işaretleri serbest', () => {
    for (const bad of ['<script>x</script>', 'a <b>b</b>', '</p>', '<!-- x -->', 'a\u0000b']) {
      expect(CreateAnnouncementInput.safeParse({ ...base, title: bad }).success, bad).toBe(false);
      expect(CreateAnnouncementInput.safeParse({ ...base, body: bad }).success, bad).toBe(false);
    }
    expect(CreateAnnouncementInput.safeParse({ ...base, body: '5 < 6 ve 7 > 3' }).success).toBe(
      true,
    );
    expect(CreateAnnouncementInput.safeParse({ ...base, body: 'Satır 1\nSatır 2' }).success).toBe(
      true,
    );
  });

  it('uzunluk sınırları', () => {
    expect(CreateAnnouncementInput.safeParse({ ...base, title: 'a'.repeat(121) }).success).toBe(
      false,
    );
    expect(CreateAnnouncementInput.safeParse({ ...base, body: 'a'.repeat(1001) }).success).toBe(
      false,
    );
    expect(CreateAnnouncementInput.safeParse({ ...base, title: '   ' }).success).toBe(false);
  });
});

describe('KK-P27-ANN-C2: aralık ve alanlar', () => {
  it('hedef kitle varsayılanı all; bitiş başlangıçtan sonra olmalı; bilinmeyen alan reddedilir', () => {
    expect(CreateAnnouncementInput.parse(base).audience).toBe('all');
    const from = '2026-10-20T10:00:00.000Z';
    expect(
      CreateAnnouncementInput.safeParse({ ...base, activeFrom: from, activeUntil: from }).success,
    ).toBe(false);
    expect(
      CreateAnnouncementInput.safeParse({
        ...base,
        activeFrom: from,
        activeUntil: '2026-10-20T11:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(CreateAnnouncementInput.safeParse({ ...base, html: 'x' }).success).toBe(false);
    expect(CreateAnnouncementInput.safeParse({ ...base, audience: 'barolar' }).success).toBe(false);
  });

  it('güncelleme kısmidir ama boş olamaz; null bitiş süresiz demektir', () => {
    expect(UpdateAnnouncementInput.safeParse({}).success).toBe(false);
    expect(UpdateAnnouncementInput.parse({ activeUntil: null })).toEqual({ activeUntil: null });
    expect(UpdateAnnouncementInput.safeParse({ title: '<i>x</i>' }).success).toBe(false);
  });
});

describe('KK-P27-ANN-C3: yanıt şemaları sıkı', () => {
  it('uygulama DTO fazladan alan kabul etmez (hedef kitle istemciye gitmez)', () => {
    const dto = {
      id: '0198a000-0000-7000-8000-000000000001',
      severity: 'warning',
      title: 'T',
      body: 'B',
      activeFrom: '2026-10-16T08:00:00.000Z',
      activeUntil: null,
    };
    expect(AnnouncementDto.safeParse(dto).success).toBe(true);
    expect(AnnouncementDto.safeParse({ ...dto, audience: 'all' }).success).toBe(false);
  });

  it('bildirim özeti kişi alanı taşımaz', () => {
    const ok = {
      from: '2026-10-01',
      to: '2026-10-16',
      items: [{ type: 'reminder', sent: 3, read: 1 }],
      totals: { sent: 3, read: 1 },
    };
    expect(AdminNotificationSummaryResponse.safeParse(ok).success).toBe(true);
    expect(
      AdminNotificationSummaryResponse.safeParse({
        ...ok,
        items: [{ type: 'reminder', sent: 3, read: 1, userId: 'x' }],
      }).success,
    ).toBe(false);
  });
});
