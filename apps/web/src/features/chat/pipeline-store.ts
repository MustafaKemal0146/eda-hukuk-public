// Ajan hattı durumu (052 §5.7; 053-02 §5.4): geçici `data-pipeline` olaylarından tur başına satır
// listesi. Araç olayları `callId` ile satıra eşlenir (paralel çağrılar ayrı satır); diğer aşamalar
// aşama adıyla tek satırdır. Saf işlevler: React durumu `use-pipeline.ts`'te tutulur.
import type { PipelineData } from '@eda/contracts/stream';

export type PipelineRow = {
  key: string;
  stage: PipelineData['stage'];
  status: PipelineData['status'];
  label: string;
  toolName: string | null;
  /** Sunucunun kayıttan ürettiği ayrıntı (künye, sonuç sayısı); model metni değildir. */
  detail: string | null;
  progress: PipelineData['progress'] | null;
  queue: PipelineData['queue'] | null;
  startedAt: number;
  endedAt: number | null;
};

export type PipelineState = {
  startedAt: number;
  endedAt: number | null;
  rows: readonly PipelineRow[];
};

export type PipelineOutcome = 'done' | 'stopped' | 'error';

const ACTIVE: ReadonlySet<PipelineData['status']> = new Set(['started', 'progress']);

export function isActiveRow(row: PipelineRow): boolean {
  return ACTIVE.has(row.status);
}

export function startPipeline(now: number): PipelineState {
  return { startedAt: now, endedAt: null, rows: [] };
}

function findRowIndex(rows: readonly PipelineRow[], ev: PipelineData): number {
  // Çağrı kimliği taşıyan her olay (ör. canlı kuyruk aşaması) aynı araç satırını günceller.
  if (ev.callId) return rows.findIndex((r) => r.key === `tool:${ev.callId}`);
  if (ev.stage !== 'tool') return rows.findIndex((r) => r.key === `stage:${ev.stage}`);
  // Çağrı kimliği yoksa: aynı aracın hâlâ çalışan son satırı.
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i];
    if (r && r.stage === 'tool' && r.toolName === (ev.toolName ?? null) && isActiveRow(r)) return i;
  }
  return -1;
}

function newKey(rows: readonly PipelineRow[], ev: PipelineData): string {
  if (ev.callId) return `tool:${ev.callId}`;
  if (ev.stage !== 'tool') return `stage:${ev.stage}`;
  return `tool:${ev.toolName ?? 'arac'}:${rows.length}`;
}

/** Tek olayı uygular. Etiket yalnız `started`/`progress` olayında güncellenir: kapanış etiketi
 * ("Yanıt tamamlandı" gibi) satırın adı olmaz (R8 W-46). Uzlaşmış hat değişmez. */
export function applyPipelineEvent(
  state: PipelineState,
  ev: PipelineData,
  now: number,
): PipelineState {
  if (state.endedAt !== null) return state;
  // Sentez atlandı: model bu adımda yanıt yerine araç çağırdı; satır kaldırılır (ara not yanıt değildir).
  if (ev.stage === 'synthesis' && ev.status === 'skipped') {
    return { ...state, rows: state.rows.filter((r) => r.key !== 'stage:synthesis') };
  }
  const rows = [...state.rows];
  const idx = findRowIndex(rows, ev);
  const ended = ACTIVE.has(ev.status) ? null : now;
  const prev = idx === -1 ? undefined : rows[idx];
  if (prev === undefined) {
    rows.push({
      key: newKey(rows, ev),
      stage: ev.stage,
      status: ev.status,
      label: ev.label,
      toolName: ev.toolName ?? null,
      detail: ev.detail ?? null,
      progress: ev.progress ?? null,
      queue: ev.queue ?? null,
      startedAt: now,
      endedAt: ended,
    });
  } else {
    rows[idx] = {
      ...prev,
      status: ev.status,
      label: ACTIVE.has(ev.status) ? ev.label : prev.label,
      detail: ev.detail ?? prev.detail,
      progress: ev.progress ?? (ACTIVE.has(ev.status) ? prev.progress : null),
      queue: ev.queue ?? (ACTIVE.has(ev.status) ? prev.queue : null),
      // Yeniden başlayan aşama (ör. ikinci sentez) yeni süre ölçer.
      startedAt: ACTIVE.has(ev.status) && !isActiveRow(prev) ? now : prev.startedAt,
      endedAt: ended,
    };
  }
  return { ...state, rows };
}

/** Tur kapanışı (finish / stop / error): hiçbir satır "çalışıyor" kalamaz (053-02 §5.4). */
export function settlePipeline(
  state: PipelineState,
  now: number,
  outcome: PipelineOutcome,
): PipelineState {
  if (state.endedAt !== null) return state;
  const closing: PipelineData['status'] =
    outcome === 'done' ? 'done' : outcome === 'stopped' ? 'skipped' : 'error';
  return {
    ...state,
    endedAt: now,
    rows: state.rows.map((r) =>
      isActiveRow(r) ? { ...r, status: closing, endedAt: now, progress: null, queue: null } : r,
    ),
  };
}

export type ToolCount = { toolName: string; count: number };

export type PipelineView = {
  settled: boolean;
  /** Şu an çalışan satırlar (paralel araçlar dahil), geliş sırasıyla. */
  active: PipelineRow[];
  steps: number;
  elapsedMs: number;
  /** Tamamlanan araç çağrıları, araç adına göre ilk görülme sırasıyla. */
  toolCounts: ToolCount[];
  failed: number;
  /** Durdurmayla kapanan (atlanan) satırlar. */
  skipped: number;
};

export function pipelineView(state: PipelineState, now: number): PipelineView {
  const counts = new Map<string, number>();
  let failed = 0;
  let skipped = 0;
  for (const r of state.rows) {
    if (r.status === 'error') failed += 1;
    if (r.status === 'skipped') skipped += 1;
    if (r.stage === 'tool' && r.status === 'done' && r.toolName) {
      counts.set(r.toolName, (counts.get(r.toolName) ?? 0) + 1);
    }
  }
  return {
    settled: state.endedAt !== null,
    active: state.rows.filter(isActiveRow),
    steps: state.rows.length,
    elapsedMs: Math.max(0, (state.endedAt ?? now) - state.startedAt),
    toolCounts: [...counts].map(([toolName, count]) => ({ toolName, count })),
    failed,
    skipped,
  };
}

export function rowElapsedMs(row: PipelineRow, now: number): number {
  return Math.max(0, (row.endedAt ?? now) - row.startedAt);
}

/** Araç künye ayrıntısı mı (karar/madde getirme) yoksa sayım mı ("3 karar"): görünüm farkı için. */
export function isKunyeDetail(row: PipelineRow): boolean {
  return row.toolName === 'get_decision' || row.toolName === 'get_legislation_article';
}
