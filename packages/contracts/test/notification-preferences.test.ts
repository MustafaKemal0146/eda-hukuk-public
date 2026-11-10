// @tk TK-33
// P28 D1 (045 §5): varsayılan matris, zorunlu kanal kuralı ve gönderim anı kanal çözümü.
//  KK-P28-1 varsayılan matris 045 §5.3 ile aynen   KK-P28-2 zorunlu kanal kapatılamaz
//  KK-P28-3 push/e-posta kapıları (abonelik, doğrulama)   KK-P28-4 kapsam: V1.1 ve eylem/güvenlik türleri yok
import { describe, expect, it } from 'vitest';
import {
  NotificationPreferencesResponse,
  PutNotificationPreferencesInput,
} from '../src/api/notification-preferences.ts';
import {
  type ChannelOverride,
  NOTIFICATION_DEFAULTS,
  overrideProblem,
  PREFERENCE_KINDS,
  preferenceMatrix,
  resolveChannels,
} from '../src/notifications.ts';

const enabledOf = (cells: ReturnType<typeof preferenceMatrix>, kind: string, channel: string) =>
  cells.find((c) => c.kind === kind && c.channel === channel)?.enabled;

describe('KK-P28-1: varsayılan matris (045 §5.3)', () => {
  const cells = preferenceMatrix([]);
  it.each([
    ['reminder', true, false, true],
    ['deadline_due', true, true, true],
    ['file_ready', true, false, undefined],
    ['file_failed', true, false, undefined],
    ['export_ready', true, false, undefined],
    ['kunye_check_ready', true, false, undefined],
    ['credit_low', true, true, undefined],
  ] as const)('%s: uygulama içi / e-posta / push', (kind, inApp, email, push) => {
    expect(enabledOf(cells, kind, 'in_app')).toBe(inApp);
    expect(enabledOf(cells, kind, 'email')).toBe(email);
    expect(enabledOf(cells, kind, 'push')).toBe(push);
  });

  it("matris yalnız MVP'de değiştirilebilen yedi türü içerir", () => {
    expect(new Set(cells.map((c) => c.kind))).toEqual(new Set(PREFERENCE_KINDS));
    expect(PREFERENCE_KINDS).toHaveLength(7);
  });
});

describe('KK-P28-2: zorunlu kanal', () => {
  it('uygulama içi hatırlatıcı ve süre kapatılamaz; geçersiz kılma yok sayılır', () => {
    const off: ChannelOverride[] = [
      { kind: 'reminder', channel: 'in_app', enabled: false },
      { kind: 'deadline_due', channel: 'in_app', enabled: false },
    ];
    const cells = preferenceMatrix(off);
    expect(enabledOf(cells, 'reminder', 'in_app')).toBe(true);
    expect(enabledOf(cells, 'deadline_due', 'in_app')).toBe(true);
    expect(overrideProblem({ kind: 'reminder', channel: 'in_app' })).toBe('channel_mandatory');
  });

  it('karantina nedeni (file_failed) ve kredi uyarısı uygulama içi kapatılamaz', () => {
    expect(overrideProblem({ kind: 'file_failed', channel: 'in_app' })).toBe('channel_mandatory');
    expect(overrideProblem({ kind: 'credit_low', channel: 'in_app' })).toBe('channel_mandatory');
  });

  it('desteklenmeyen kanal (iş bildirimi için push) değiştirilemez', () => {
    expect(overrideProblem({ kind: 'file_ready', channel: 'push' })).toBe('channel_mandatory');
  });

  it('değiştirilebilir kanal serbest; geçersiz kılma uygulanır', () => {
    expect(overrideProblem({ kind: 'reminder', channel: 'email' })).toBeNull();
    const cells = preferenceMatrix([
      { kind: 'reminder', channel: 'email', enabled: true },
      { kind: 'deadline_due', channel: 'push', enabled: false },
    ]);
    expect(enabledOf(cells, 'reminder', 'email')).toBe(true);
    expect(enabledOf(cells, 'deadline_due', 'push')).toBe(false);
  });

  it('kilitli hücre `mandatory`, değiştirilebilir değil', () => {
    const cells = preferenceMatrix([]);
    expect(cells.find((c) => c.kind === 'reminder' && c.channel === 'in_app')?.mandatory).toBe(
      true,
    );
    expect(cells.find((c) => c.kind === 'reminder' && c.channel === 'push')?.mandatory).toBe(false);
  });
});

describe('KK-P28-3: gönderim anı çözümü (045 §5.1)', () => {
  const base = { kind: 'deadline_due', overrides: [], emailVerified: true } as const;
  it('abonelik yoksa push düşer, uygulama içi ve e-posta kalır', () => {
    expect(resolveChannels({ ...base, hasPushSubscription: false })).toEqual(['in_app', 'email']);
    expect(resolveChannels({ ...base, hasPushSubscription: true })).toEqual([
      'in_app',
      'email',
      'push',
    ]);
  });
  it('e-postası doğrulanmamış kullanıcıya e-posta gitmez', () => {
    expect(resolveChannels({ ...base, hasPushSubscription: false, emailVerified: false })).toEqual([
      'in_app',
    ]);
  });
  it('kullanıcı e-postayı kapatınca yalnız zorunlu uygulama içi kalır', () => {
    expect(
      resolveChannels({
        kind: 'deadline_due',
        overrides: [
          { kind: 'deadline_due', channel: 'email', enabled: false },
          { kind: 'deadline_due', channel: 'push', enabled: false },
        ],
        hasPushSubscription: true,
        emailVerified: true,
      }),
    ).toEqual(['in_app']);
  });
});

describe('KK-P28-4: kapsam ve şemalar', () => {
  it('eylem/güvenlik sınıfı ve V1.1 türleri tercih matrisinde yok', () => {
    for (const k of ['password_reset', 'password_changed', 'announcement', 'invitation']) {
      expect(PREFERENCE_KINDS as readonly string[]).not.toContain(k);
    }
    expect(Object.keys(NOTIFICATION_DEFAULTS).sort()).toEqual([...PREFERENCE_KINDS].sort());
  });

  it('PUT şeması bilinmeyen türü ve fazla alanı reddeder', () => {
    expect(
      PutNotificationPreferencesInput.safeParse({
        overrides: [{ kind: 'password_reset', channel: 'email', enabled: false }],
      }).success,
    ).toBe(false);
    expect(
      PutNotificationPreferencesInput.safeParse({
        overrides: [{ kind: 'reminder', channel: 'email', enabled: true, x: 1 }],
      }).success,
    ).toBe(false);
    expect(
      PutNotificationPreferencesInput.safeParse({
        overrides: [{ kind: 'reminder', channel: 'email', enabled: true }],
      }).success,
    ).toBe(true);
  });

  it('yanıt şeması matrisi doğrular', () => {
    expect(NotificationPreferencesResponse.safeParse({ items: preferenceMatrix([]) }).success).toBe(
      true,
    );
  });
});
