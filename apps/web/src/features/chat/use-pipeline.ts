'use client';
// Tur başına ajan hattı durumu (pipeline-store saf işlevlerinin React sarmalayıcısı). Geçici olaylar
// yalnız bellekte tutulur, mesaja kaydedilmez; tur kapanınca durum asistan mesaj kimliğine bağlanır.
import type { PipelineData } from '@eda/contracts/stream';
import { useCallback, useMemo, useState } from 'react';
import {
  applyPipelineEvent,
  type PipelineOutcome,
  type PipelineState,
  settlePipeline,
  startPipeline,
} from './pipeline-store.ts';

type TrackerState = {
  current: PipelineState | null;
  byMessage: ReadonlyMap<string, PipelineState>;
};

export type PipelineTracker = TrackerState & {
  begin: () => void;
  push: (event: PipelineData) => void;
  settle: (messageId: string | null, outcome: PipelineOutcome) => void;
};

export function usePipelineTracker(): PipelineTracker {
  const [state, setState] = useState<TrackerState>({ current: null, byMessage: new Map() });

  const begin = useCallback(() => {
    setState((s) => ({ ...s, current: startPipeline(Date.now()) }));
  }, []);

  const push = useCallback((event: PipelineData) => {
    setState((s) => {
      const now = Date.now();
      return { ...s, current: applyPipelineEvent(s.current ?? startPipeline(now), event, now) };
    });
  }, []);

  const settle = useCallback((messageId: string | null, outcome: PipelineOutcome) => {
    setState((s) => {
      if (!s.current) return s;
      const done = settlePipeline(s.current, Date.now(), outcome);
      if (messageId === null) return { ...s, current: null };
      const byMessage = new Map(s.byMessage);
      byMessage.set(messageId, done);
      return { current: null, byMessage };
    });
  }, []);

  return useMemo(() => ({ ...state, begin, push, settle }), [state, begin, push, settle]);
}
