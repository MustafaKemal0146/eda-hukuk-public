// Yapay zekâ ekranı görünüm modeli: saf işlevler (test edilebilir; tarayıcı bağımlılığı yok).
import type {
  AdminAiCatalogResponseValue,
  AdminAiModelDtoValue,
  AdminAiUsageResponseValue,
} from '@eda/contracts/api/admin-ai';

/** Etkinleştirme/pasifleştirme sunucu kuralları: arayüz de aynı kuralı ön denetim olarak uygular. */
export type ToggleBlock = 'provider_disabled' | 'last_enabled' | null;

export function toggleBlock(
  catalog: AdminAiCatalogResponseValue,
  model: AdminAiModelDtoValue,
): ToggleBlock {
  const provider = catalog.providers.find((p) => p.id === model.providerId);
  if (!model.enabled) return provider?.enabled === true ? null : 'provider_disabled';
  const others = catalog.models.filter(
    (m) =>
      m.alias === model.alias &&
      m.id !== model.id &&
      m.enabled &&
      catalog.providers.find((p) => p.id === m.providerId)?.enabled === true,
  );
  return others.length === 0 ? 'last_enabled' : null;
}

export type ErrorTone = 'success' | 'warning' | 'danger' | 'neutral';

/** Hata oranına göre rozet tonu (eşikler yalnız görsel ipucudur, karar vermez). */
export function errorTone(calls: number, rate: number): ErrorTone {
  if (calls === 0) return 'neutral';
  if (rate >= 0.1) return 'danger';
  if (rate >= 0.02) return 'warning';
  return 'success';
}

export function usageOf(
  usage: AdminAiUsageResponseValue,
  alias: string,
  providerId: string,
): AdminAiUsageResponseValue['items'][number] | undefined {
  return usage.items.find((i) => i.alias === alias && i.providerId === providerId);
}
