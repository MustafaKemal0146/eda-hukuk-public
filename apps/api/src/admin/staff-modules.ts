// Personel modüllerinin (Şablonlar, Destek, Veri seti) servislerini tek yerde kurar.
import type { AdminDb } from '@eda/db/admin';
import { createDatasetsService } from './datasets-service.ts';
import type { StaffModules } from './routes/staff-modules.ts';
import { createSupportService } from './support-service.ts';
import { createTemplatesService } from './templates-service.ts';

export function createStaffModules(deps: { readonly db: AdminDb }): StaffModules {
  return {
    templates: createTemplatesService(deps),
    support: createSupportService(deps),
    datasets: createDatasetsService(deps),
  };
}
