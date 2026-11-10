// Yargı kapsamı kataloğu (053/02 §4.3, 052 `ScopePicker`; P12 K5). Arayüz metni burada değil, `tr`
// kataloğundadır; yalnız model çerçevesine giden kurum adları (`promptLabel`) sunucu tarafında gerekir.
// Uç nokta adları arayüzde gösterilmez (R8 §9.4): öğe kimliği kurumdur, `source` yalnız yönlendirmedir.
import type { SourceCode } from '../enums.ts';
import type { DecisionLiveSourceCode } from '../mcp/common.ts';
import type { CourtType } from '../tools/common.ts';

export const SCOPE_GROUPS = ['adli', 'idari', 'anayasa', 'yargi_yolu', 'mevzuat'] as const;
export type ScopeGroup = (typeof SCOPE_GROUPS)[number];

export const SCOPE_ITEM_IDS = [
  'yargitay',
  'kyb',
  'istinaf',
  'ilk_derece',
  'danistay',
  'aym',
  'uyusmazlik',
  'mevzuat',
] as const;
export type ScopeItemId = (typeof SCOPE_ITEM_IDS)[number];

export type ScopeItem = {
  id: ScopeItemId;
  group: ScopeGroup;
  /** Yargıtay'ın alt seçeneği gibi girintili gösterilen öğeler. */
  parent: ScopeItemId | null;
  courtTypes: readonly CourtType[];
  source: Extract<SourceCode, 'bedesten' | 'anayasa' | 'uyusmazlik' | 'mevzuat'>;
  promptLabel: string;
};

export const SCOPE_CATALOG: readonly ScopeItem[] = [
  {
    id: 'yargitay',
    group: 'adli',
    parent: null,
    courtTypes: ['yargitay'],
    source: 'bedesten',
    promptLabel: 'Yargıtay',
  },
  {
    id: 'kyb',
    group: 'adli',
    parent: 'yargitay',
    courtTypes: ['kyb'],
    source: 'bedesten',
    promptLabel: 'Kanun yararına bozma',
  },
  {
    id: 'istinaf',
    group: 'adli',
    parent: null,
    courtTypes: ['istinaf_hukuk'],
    source: 'bedesten',
    promptLabel: 'İstinaf',
  },
  {
    id: 'ilk_derece',
    group: 'adli',
    parent: null,
    courtTypes: ['ilk_derece_hukuk'],
    source: 'bedesten',
    promptLabel: 'İlk derece',
  },
  {
    id: 'danistay',
    group: 'idari',
    parent: null,
    courtTypes: ['danistay'],
    source: 'bedesten',
    promptLabel: 'Danıştay',
  },
  {
    id: 'aym',
    group: 'anayasa',
    parent: null,
    courtTypes: ['aym_bireysel', 'aym_norm'],
    source: 'anayasa',
    promptLabel: 'Anayasa Mahkemesi',
  },
  {
    id: 'uyusmazlik',
    group: 'yargi_yolu',
    parent: null,
    courtTypes: ['uyusmazlik'],
    source: 'uyusmazlik',
    promptLabel: 'Uyuşmazlık Mahkemesi',
  },
  {
    id: 'mevzuat',
    group: 'mevzuat',
    parent: null,
    courtTypes: [],
    source: 'mevzuat',
    promptLabel: 'Mevzuat',
  },
];

/** "Kapsamda değil" (pasif) kurumlar: seçilemez, vaat metni yazılmaz (053/02 §4.3 madde 3). */
export const SCOPE_OUT_OF_COVERAGE = [
  'sayistay',
  'kik',
  'rekabet',
  'gib',
  'kvkk_kurulu',
  'bddk',
  'sigorta_tahkim',
] as const;
export type ScopeOutOfCoverageId = (typeof SCOPE_OUT_OF_COVERAGE)[number];

export const SCOPE_PRESET_IDS = [
  'auto',
  'private_law',
  'admin_tax',
  'constitutional_dispute',
] as const;
export type ScopePresetId = (typeof SCOPE_PRESET_IDS)[number];

/**
 * Hazır ayarlar; `null` = açık tüm kaynaklar (Akıllı otomatik seçim). : mahkeme hazır ayarları
 * mevzuatı da içerir (sohbet cevabı madde metnine dayanır; 053/02 hazır ayar etiketleri yalnız
 * mahkemeleri adlandırır).
 */
export const SCOPE_PRESETS: Readonly<Record<ScopePresetId, readonly ScopeItemId[] | null>> = {
  auto: null,
  private_law: ['yargitay', 'kyb', 'istinaf', 'mevzuat'],
  admin_tax: ['danistay', 'mevzuat'],
  constitutional_dispute: ['aym', 'uyusmazlik', 'mevzuat'],
};

/** İstek gövdesindeki `scope` alt kümesi (022 §2.1 + K5). `courtTypes: null` = hepsi. */
export type ScopeSelection = { sources: SourceCode[]; courtTypes: CourtType[] | null };

const byId = new Map(SCOPE_CATALOG.map((i) => [i.id, i]));

/** Seçim → istek: boş/null seçim "Akıllı otomatik seçim"e döner (KK-053-02-7). */
export function scopeToRequest(ids: readonly ScopeItemId[] | null): ScopeSelection {
  if (ids === null || ids.length === 0) return { sources: [], courtTypes: null };
  const items = SCOPE_CATALOG.filter((i) => ids.includes(i.id));
  const sources = [...new Set(items.map((i) => i.source))];
  return { sources, courtTypes: items.flatMap((i) => i.courtTypes) };
}

/** İstek → seçim (geri yükleme ve sunucu etiketi için); `null` = otomatik. */
export function scopeFromRequest(scope: {
  sources: readonly SourceCode[];
  courtTypes?: readonly CourtType[] | null;
}): ScopeItemId[] | null {
  if (scope.courtTypes === null || scope.courtTypes === undefined) {
    return scope.sources.length === 0
      ? null
      : SCOPE_CATALOG.filter((i) => scope.sources.includes(i.source)).map((i) => i.id);
  }
  const types = scope.courtTypes;
  return SCOPE_CATALOG.filter((i) =>
    i.courtTypes.length === 0
      ? scope.sources.includes(i.source)
      : i.courtTypes.every((c) => types.includes(c)),
  ).map((i) => i.id);
}

/** Model çerçevesindeki `Kapsam:` satırı (024 `chat.turn_frame` `scope_label`). */
export function scopePromptLabel(ids: readonly ScopeItemId[] | null): string {
  if (ids === null) return 'Tümü';
  return ids.map((id) => byId.get(id)?.promptLabel ?? id).join(', ');
}

/** Mevzuat yüzeyi kapsamda mı (`sources` boş = hepsi). */
export const scopeAllowsLegislation = (s: ScopeSelection): boolean =>
  s.sources.length === 0 || s.sources.includes('mevzuat');

/**
 * Model istediği mahkeme türlerini kapsamla keser. `null` sonuç = kısıt yok; boş dizi = kapsamda
 * karar kaynağı yok (araç çağrısı yapılmaz).
 */
export function effectiveCourtTypes(
  scope: ScopeSelection,
  requested: readonly CourtType[] | null,
): CourtType[] | null {
  if (scope.courtTypes === null) return requested === null ? null : [...requested];
  if (requested === null) return [...scope.courtTypes];
  const allowed = scope.courtTypes;
  return requested.filter((c) => allowed.includes(c));
}

/** `court_type` → canlı kaynak (P12 K7 tablosu). */
export const COURT_TYPE_SOURCE: Readonly<Record<CourtType, DecisionLiveSourceCode>> = {
  yargitay: 'bedesten',
  danistay: 'bedesten',
  istinaf_hukuk: 'bedesten',
  ilk_derece_hukuk: 'bedesten',
  kyb: 'bedesten',
  aym_norm: 'anayasa',
  aym_bireysel: 'anayasa',
  uyusmazlik: 'uyusmazlik',
};

const LIVE_PRIORITY: readonly DecisionLiveSourceCode[] = ['bedesten', 'anayasa', 'uyusmazlik'];

/**
 * P12 K7: tek canlı çağrı tek kaynağa gider; etkin mahkeme türlerinin öncelikli ilk kaynağı seçilir ve
 * yalnız o kaynağa ait türler iletilir. `null` = kısıtsız (Bedesten, tür süzgeci yok).
 */
export function pickLiveSource(courtTypes: readonly CourtType[] | null): {
  source: DecisionLiveSourceCode;
  courtTypes: CourtType[] | null;
} {
  if (courtTypes === null) return { source: 'bedesten', courtTypes: null };
  const source =
    LIVE_PRIORITY.find((s) => courtTypes.some((c) => COURT_TYPE_SOURCE[c] === s)) ?? 'bedesten';
  return { source, courtTypes: courtTypes.filter((c) => COURT_TYPE_SOURCE[c] === source) };
}

/** Kaynak kartı işareti: karar mahkeme türünden, mevzuat kaynağından kurum öğesi. */
export function scopeItemOf(source: {
  kind: string;
  courtType?: CourtType | undefined;
}): ScopeItemId | null {
  if (source.kind === 'legislation') return 'mevzuat';
  if (source.courtType === undefined) return null;
  return (
    SCOPE_CATALOG.find((i) => i.courtTypes.includes(source.courtType as CourtType))?.id ?? null
  );
}
