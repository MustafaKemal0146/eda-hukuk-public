// `corpus` kuyruğu yük şemaları (043 §3.2; 021 §5.14, §7.3). Zamanlayıcıdan gelen işler zarf dışında
// alan taşımaz (`{ v: 1 }`); diğer korpus işleri ilgili promptlarda eklenir.
import type { z } from 'zod';
import { JobEnvelope } from './envelope.ts';

/** `source_status.canary` (021 §7.3): zarfın kendisi; sorgular sabittir, yükte taşınmaz. */
export const SourceStatusCanaryPayload = JobEnvelope.extend({}).strict();
export type SourceStatusCanaryPayload = z.infer<typeof SourceStatusCanaryPayload>;
