'use client';
// Ayarlar kabı (P23 ilk dilim): `/api/v1/me` yükler, yükleme/hata durumlarını yönetir ve saf
// görünümü (`settings-view.tsx`) besler. Görünüm tercihleri cihazda çerezle uygulanır; sunucuya
// istek atmaz (051 §14). Parola değişimi Better Auth ucudur (`settings-api.ts`).
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AuthApiError } from '../../lib/auth-api.ts';
import { useComposerMode, writeComposerMode } from '../chat/composer-mode-store.ts';
import {
  applyUiPrefs,
  type Density,
  readUiPrefs,
  subscribeUiPrefs,
  type Theme,
  type UiPrefs,
} from '../shell/ui-prefs.ts';
import {
  ApiClientError as AiKeysApiError,
  chooseKeySource,
  loadAiKeys,
  removeOrgKey,
  removeOwnKey,
  saveOrgKey,
  saveOwnKey,
} from './ai-keys-api.ts';
import {
  type AiKeySaveProblem,
  type AiKeySource,
  type AiKeysLoadState,
  type AiKeysState,
  saveProblemOf as aiKeyProblemOf,
} from './ai-keys-model.ts';
import {
  ApiClientError,
  loadNotificationPreferences,
  saveNotificationPreference,
} from './notifications-api.ts';
import {
  type NotificationCell,
  type NotificationChannelValue,
  type NotificationsLoadState,
  type PreferenceKindValue,
  type SaveProblem,
  saveProblemOf,
  withCell,
} from './notifications-model.ts';
import { cellKey } from './notifications-panel.tsx';
import { changePassword, loadSettings } from './settings-api.ts';
import { SECTION_SLUGS, type SettingsModel, tabOfSlug } from './settings-model.ts';
import { type SettingsLoadState, SettingsView } from './settings-view.tsx';

export function SettingsHome() {
  const [state, setState] = useState<SettingsLoadState>('loading');
  const [model, setModel] = useState<SettingsModel | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('system');
  const [density, setDensity] = useState<Density>('comfortable');
  // Varsayılan yanıt modu, sohbet yazma alanının hatırladığı tercihle AYNI kayıttır.
  const mode = useComposerMode();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab = tabOfSlug(useSearchParams().get('bolum'));

  const load = useCallback(async () => {
    setState('loading');
    try {
      setModel(await loadSettings());
      setState('ready');
    } catch (error) {
      setRequestId(error instanceof AuthApiError ? error.requestId : null);
      setState('error');
    }
  }, []);

  // Tema menüsü ve komut paleti de aynı tercihi değiştirir; kök özniteliği tek kaynak olarak
  // dinlenir, böylece sekmeler başka yerden yapılan değişikliği de gösterir.
  useEffect(() => {
    const sync = (prefs: UiPrefs): void => {
      setTheme(prefs.theme);
      setDensity(prefs.density);
    };
    sync(readUiPrefs());
    return subscribeUiPrefs(sync);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const [notifState, setNotifState] = useState<NotificationsLoadState>('loading');
  const [cells, setCells] = useState<NotificationCell[]>([]);
  const [notifRequestId, setNotifRequestId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [problem, setProblem] = useState<SaveProblem | null>(null);

  const loadNotifications = useCallback(async () => {
    setNotifState('loading');
    try {
      setCells(await loadNotificationPreferences());
      setNotifState('ready');
    } catch (error) {
      setNotifRequestId(error instanceof ApiClientError ? error.requestId : null);
      setNotifState('error');
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const [keysState, setKeysState] = useState<AiKeysLoadState>('loading');
  const [keys, setKeys] = useState<AiKeysState | null>(null);
  const [keysRequestId, setKeysRequestId] = useState<string | null>(null);
  const [keysBusy, setKeysBusy] = useState(false);

  const loadKeys = useCallback(async () => {
    setKeysState('loading');
    try {
      setKeys(await loadAiKeys());
      setKeysState('ready');
    } catch (error) {
      setKeysRequestId(error instanceof AiKeysApiError ? error.requestId : null);
      setKeysState('error');
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  /** Kayıt: başarılıysa yeni durumu alır ve `null` döner; hata ekran türüne çevrilir. */
  const runKeyAction = useCallback(
    async (action: () => Promise<AiKeysState>): Promise<AiKeySaveProblem | null> => {
      setKeysBusy(true);
      try {
        setKeys(await action());
        return null;
      } catch (error) {
        if (error instanceof AiKeysApiError) {
          return aiKeyProblemOf(error.status, error.code, error.reason);
        }
        return 'failed';
      } finally {
        setKeysBusy(false);
      }
    },
    [],
  );

  const toggleNotification = useCallback(
    async (kind: PreferenceKindValue, channel: NotificationChannelValue, enabled: boolean) => {
      setProblem(null);
      setSavingKey(cellKey(kind, channel));
      const before = cells;
      setCells((current) => withCell(current, kind, channel, enabled));
      try {
        setCells(await saveNotificationPreference(kind, channel, enabled));
      } catch (error) {
        setCells(before);
        setProblem(
          error instanceof ApiClientError ? saveProblemOf(error.status, error.reason) : 'failed',
        );
      } finally {
        setSavingKey(null);
      }
    },
    [cells],
  );

  return (
    <SettingsView
      state={state}
      model={model}
      requestId={requestId}
      onRetry={() => void load()}
      theme={theme}
      density={density}
      onTheme={(value) => {
        setTheme(value);
        applyUiPrefs({ ...readUiPrefs(), theme: value });
      }}
      onDensity={(value) => {
        setDensity(value);
        applyUiPrefs({ ...readUiPrefs(), density: value });
      }}
      initialTab={initialTab}
      onTabChange={(tab) =>
        router.replace(`${pathname}?bolum=${SECTION_SLUGS[tab]}`, { scroll: false })
      }
      mode={mode}
      onMode={writeComposerMode}
      masking
      onMasking={() => undefined}
      onChangePassword={changePassword}
      apiKeys={{
        state: keysState,
        keys,
        requestId: keysRequestId,
        busy: keysBusy,
        onRetry: () => void loadKeys(),
        onSource: (source: AiKeySource) => void runKeyAction(() => chooseKeySource(source)),
        onSaveOrg: (apiKey) => runKeyAction(() => saveOrgKey(apiKey)),
        onRemoveOrg: () => void runKeyAction(removeOrgKey),
        onSaveOwn: (apiKey) => runKeyAction(() => saveOwnKey(apiKey)),
        onRemoveOwn: () => void runKeyAction(removeOwnKey),
      }}
      notifications={{
        state: notifState,
        cells,
        savingKey,
        problem,
        requestId: notifRequestId,
        onRetry: () => void loadNotifications(),
        onToggle: (kind, channel, enabled) => void toggleNotification(kind, channel, enabled),
      }}
    />
  );
}
