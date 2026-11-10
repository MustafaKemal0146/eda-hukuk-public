// /ready (040 §11): sert bağımlılıklar (postgres, valkey) başarısızsa 503; yumuşaklar yalnız
// 'degraded' olarak raporlanır. Sonuç health.readyCacheMs süresince önbelleklenir. Gövde host,
// adres veya hata metni içermez.
import type { RuntimeState } from '../context/types.ts';

export type CheckState = 'ok' | 'fail' | 'degraded';
export type Probe = { name: string; hard: boolean; run: () => Promise<boolean> };
export type ReadyBody = {
  status: 'ok' | 'fail';
  draining: boolean;
  version: string;
  checks: Record<string, CheckState>;
};

export function createReadiness(opts: {
  probes: readonly Probe[];
  cacheMs: number;
  version: string;
  state: RuntimeState;
  now?: () => number;
}): () => Promise<{ status: 200 | 503; body: ReadyBody }> {
  const now = opts.now ?? Date.now;
  let cached: { at: number; checks: Record<string, CheckState>; hardOk: boolean } | undefined;

  return async () => {
    if (cached === undefined || now() - cached.at >= opts.cacheMs) {
      const results = await Promise.all(opts.probes.map(async (p) => ({ p, ok: await p.run() })));
      const checks: Record<string, CheckState> = {};
      let hardOk = true;
      for (const { p, ok } of results) {
        checks[p.name] = ok ? 'ok' : p.hard ? 'fail' : 'degraded';
        if (p.hard && !ok) hardOk = false;
      }
      cached = { at: now(), checks, hardOk };
    }
    const ok = cached.hardOk && !opts.state.draining;
    return {
      status: ok ? 200 : 503,
      body: {
        status: ok ? 'ok' : 'fail',
        draining: opts.state.draining,
        version: opts.version,
        checks: cached.checks,
      },
    };
  };
}
