// @tk TK-33
// #28 (P23) / P28 D1 web dilimi: Ayarlar > Bildirimler matrisi. Model saf işlevleri ve çizim; veriler
// sentetiktir. Matris içeriği sözleşmenin `preferenceMatrix` işlevinden gelir (sunucu ile aynı kural).
import { NOTIFICATION_CHANNELS } from '@eda/contracts/enums';
import { preferenceMatrix } from '@eda/contracts/notifications';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import {
  cellEditable,
  cellOf,
  kindVisible,
  PREFERENCE_KINDS,
  saveProblemOf,
  visibleKinds,
  withCell,
} from '../src/features/settings/notifications-model.ts';
import {
  NotificationsPanel,
  type NotificationsPanelProps,
} from '../src/features/settings/notifications-panel.tsx';

const noop = () => {};
const MATRIX = preferenceMatrix([]);

const render = (over: Partial<NotificationsPanelProps> = {}): string =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'tr',
      messages,
      timeZone: 'Europe/Istanbul',
      children: createElement(NotificationsPanel, {
        state: 'ready',
        cells: MATRIX,
        emailVerified: true,
        role: 'owner',
        savingKey: null,
        problem: null,
        requestId: null,
        onRetry: noop,
        onToggle: noop,
        ...over,
      }),
    }),
  );

describe('#28: ayarlar bildirim matrisi', () => {
  it('kredi satırı yalnız büro sahibi ve yöneticisine görünür', () => {
    expect(kindVisible('credit_low', 'owner')).toBe(true);
    expect(kindVisible('credit_low', 'admin')).toBe(true);
    expect(kindVisible('credit_low', 'lawyer')).toBe(false);
    expect(kindVisible('credit_low', null)).toBe(false);
    expect(kindVisible('reminder', 'assistant')).toBe(true);
    expect(visibleKinds('lawyer')).not.toContain('credit_low');
    expect(visibleKinds('owner')).toEqual([...PREFERENCE_KINDS]);
  });

  it('iyimser güncelleme yalnız değiştirilebilir hücreyi çevirir; zorunlu hücre değişmez', () => {
    const emailBefore = cellOf(MATRIX, 'deadline_due', 'email');
    expect(emailBefore?.enabled).toBe(true);
    const off = withCell(MATRIX, 'deadline_due', 'email', false);
    expect(cellOf(off, 'deadline_due', 'email')?.enabled).toBe(false);
    // Özgün dizi değişmez.
    expect(cellOf(MATRIX, 'deadline_due', 'email')?.enabled).toBe(true);

    const mandatory = cellOf(MATRIX, 'deadline_due', 'in_app');
    expect(mandatory?.mandatory).toBe(true);
    expect(
      cellOf(withCell(MATRIX, 'deadline_due', 'in_app', false), 'deadline_due', 'in_app'),
    ).toEqual(mandatory);
  });

  it('e-posta doğrulanmadıysa e-posta hücresi düzenlenemez; zorunlu hücre hiçbir zaman', () => {
    const email = cellOf(MATRIX, 'file_ready', 'email');
    // Bu türde kullanılmayan kanal (kilitli ve kapalı) matriste yoktur; panel "—" çizer.
    expect(cellOf(MATRIX, 'file_ready', 'push')).toBeUndefined();
    const push = cellOf(MATRIX, 'reminder', 'push');
    const inApp = cellOf(MATRIX, 'deadline_due', 'in_app');
    if (!email || !push || !inApp) throw new Error('matris hücresi eksik');
    expect(cellEditable(email, true)).toBe(true);
    expect(cellEditable(email, false)).toBe(false);
    expect(cellEditable(push, false)).toBe(true);
    expect(cellEditable(inApp, true)).toBe(false);
  });

  it('kaydetme hatası: yalnız 422 channel_mandatory zorunlu kanal mesajına çevrilir', () => {
    expect(saveProblemOf(422, 'channel_mandatory')).toBe('mandatory');
    expect(saveProblemOf(422, 'baska')).toBe('failed');
    expect(saveProblemOf(500, 'channel_mandatory')).toBe('failed');
    expect(saveProblemOf(0, null)).toBe('failed');
  });

  it('matris tablosu satır/sütun başlıklarını ve zorunlu kanal notunu çizer', () => {
    const html = render();
    const n = messages.settings.notifications;
    expect(html).toContain(n.title);
    expect(html).toContain(messages.legal.mandatory.y89);
    for (const channel of NOTIFICATION_CHANNELS)
      expect(html, channel).toContain(n.channels[channel]);
    for (const kind of PREFERENCE_KINDS) expect(html, kind).toContain(n.kinds[kind].label);
    expect(html).toContain('scope="row"');
    expect(html).toContain('scope="col"');
    expect(html).toContain(n.mandatory);
    expect(html).toContain(n.pushHint);
    expect(html).toContain(n.mandatoryInfo);
  });

  it('rol kredi satırını gizler; doğrulanmamış e-posta uyarısı ve kayıt hatası gösterilir', () => {
    const n = messages.settings.notifications;
    expect(render({ role: 'lawyer' })).not.toContain(n.kinds.credit_low.label);
    expect(render({ role: 'admin' })).toContain(n.kinds.credit_low.label);

    expect(render()).not.toContain(n.emailUnverified);
    expect(render({ emailVerified: false })).toContain(n.emailUnverified);

    expect(render({ problem: 'mandatory' })).toContain(n.mandatoryError);
    expect(render({ problem: 'failed' })).toContain(n.saveFailed);
    expect(render({ problem: null })).not.toContain(n.saveFailed);
  });

  it('yükleme ve hata durumları ayrı çizilir', () => {
    const n = messages.settings.notifications;
    const loading = render({ state: 'loading', cells: [] });
    expect(loading).toContain(n.loading);
    expect(loading).toContain('aria-busy="true"');

    const error = render({
      state: 'error',
      cells: [],
      requestId: '01990000-0000-7000-8000-0000000000ff',
    });
    expect(error).toContain(n.error.title);
    expect(error).toContain(n.error.retry);
    expect(error).toContain('01990000-0000-7000-8000-0000000000ff');
  });

  it('her tür ve kanal için `tr` metni vardır', () => {
    const n = messages.settings.notifications;
    for (const kind of PREFERENCE_KINDS) {
      expect(n.kinds[kind].label, kind).toBeTruthy();
      expect(n.kinds[kind].hint, kind).toBeTruthy();
    }
    for (const channel of NOTIFICATION_CHANNELS) expect(n.channels[channel], channel).toBeTruthy();
  });
});
