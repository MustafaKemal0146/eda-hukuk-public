// Personel modülleri (Şablonlar, Destek, Veri seti) rota bağlayıcısı.
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { DatasetsService } from '../datasets-service.ts';
import type { SupportService } from '../support-service.ts';
import type { TemplatesService } from '../templates-service.ts';
import { mountAdminDatasets } from './datasets.ts';
import { mountAdminSupport } from './support.ts';
import { mountAdminTemplates } from './templates.ts';

export interface StaffModules {
  readonly templates: TemplatesService;
  readonly support: SupportService;
  readonly datasets: DatasetsService;
}

export function mountStaffModules(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  m: StaffModules,
): void {
  mountAdminTemplates(app, registry, m.templates);
  mountAdminSupport(app, registry, m.support);
  mountAdminDatasets(app, registry, m.datasets);
}
