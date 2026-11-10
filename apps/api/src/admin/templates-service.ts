// Şablonlar modülü servisi (salt okur). E-posta şablonları `@eda/email` kataloğundan (kodda sürümlü),
// belge şablonları `app.admin_document_templates` fonksiyonundan (yalnız platform şablonları; başlık,
// gövde ve değişken içeriği okunmaz). Önizleme yalnız sentetik örnek verilerle ve düz metindir.
import type {
  AdminTemplateItemDtoValue,
  AdminTemplateListResponseValue,
  AdminTemplatePreviewDtoValue,
} from '@eda/contracts/api/admin-templates';
import { EMAIL_TEMPLATE_CODES } from '@eda/contracts/notifications';
import type { AdminDb } from '@eda/db/admin';
import { emailTemplateInventory, previewEmail } from '@eda/email/preview';

export interface TemplatesServiceDeps {
  readonly db: AdminDb;
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : (v instanceof Date ? v : new Date(String(v))).toISOString();

export function createTemplatesService(deps: TemplatesServiceDeps) {
  return {
    async list(actorId: string): Promise<AdminTemplateListResponseValue> {
      const inventory = emailTemplateInventory();
      const known = new Set<string>(inventory.map((t) => t.code));
      const email: AdminTemplateItemDtoValue[] = inventory.map((t) => ({
        key: t.code,
        type: 'email',
        kind: t.kind,
        group: t.class,
        version: t.version,
        lastChanged: t.versionDate,
        implemented: true,
        active: null,
        previewable: true,
        variables: t.variables.map((v) => ({
          name: v.name,
          type: v.type,
          options: [...v.options],
          sealed: v.sealed,
        })),
      }));
      // Kodu kanonik listede olup katalogda henüz uygulanmamış şablonlar (planlanmış).
      const planned: AdminTemplateItemDtoValue[] = EMAIL_TEMPLATE_CODES.filter(
        (c) => !known.has(c),
      ).map((c) => ({
        key: c,
        type: 'email',
        kind: '',
        group: null,
        version: '',
        lastChanged: null,
        implemented: false,
        active: null,
        previewable: false,
        variables: [],
      }));
      const r = await deps.db.withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_document_templates($1)', [actorId]),
      );
      const documents: AdminTemplateItemDtoValue[] = (r.rows as Record<string, unknown>[]).map(
        (x) => ({
          key: String(x.template_id),
          type: 'document',
          kind: String(x.template_kind),
          group: (x.case_type_code as string | null) ?? null,
          version: String(x.template_version),
          lastChanged: iso(x.updated_at),
          implemented: true,
          active: Boolean(x.is_active),
          previewable: false,
          variables: [],
        }),
      );
      return {
        items: [...email, ...planned, ...documents],
        documentContentHidden: true,
      };
    },

    /** Kodu katalogda olmayan şablon için `null`. */
    preview(code: string): AdminTemplatePreviewDtoValue | null {
      const p = previewEmail(code);
      if (p === null) return null;
      return { key: p.code, version: p.version, subject: p.subject, text: p.text, synthetic: true };
    },
  };
}

export type TemplatesService = ReturnType<typeof createTemplatesService>;
