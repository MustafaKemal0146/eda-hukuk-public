// Araştırma yüzeyi (Karar Arşivi + Mevzuat) bağımlılıkları. /: kimlik ve DB gelene dek
// yalnız development/test'te kurulur; canlı kaynak paylaşılan yargi-mcp istemcisidir.
import type { ApiConfig } from '../config/load.ts';
import {
  createDecisionReader,
  createDecisionService,
  type DecisionReader,
  type DecisionService,
} from './decisions/decisions.ts';
import { LiveQuota, SearchStore } from './decisions/search-store.ts';
import { createLegislationService, type LegislationService } from './legislation/legislation.ts';
import type { LiveSource } from './sources/live-source.ts';

export type ResearchDeps = {
  decisions: DecisionService;
  reader: DecisionReader;
  legislation: LegislationService;
};

export function buildResearchDeps(
  source: LiveSource,
  opts: { uuid: () => string; now?: () => number; quota?: LiveQuota },
): ResearchDeps {
  const now = opts.now ?? Date.now;
  return {
    decisions: createDecisionService({
      source,
      store: new SearchStore(),
      quota: opts.quota ?? new LiveQuota(),
      now,
      uuid: opts.uuid,
    }),
    reader: createDecisionReader({ source, now }),
    legislation: createLegislationService({ source }),
  };
}

export function createResearchDeps(
  config: ApiConfig,
  source: LiveSource,
  uuid: () => string,
): ResearchDeps | undefined {
  const edaEnv = config.env.EDA_ENV;
  if (edaEnv !== 'development' && edaEnv !== 'test') return undefined;
  return buildResearchDeps(source, { uuid });
}
