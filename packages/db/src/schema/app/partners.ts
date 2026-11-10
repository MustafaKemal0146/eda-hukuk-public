// `app.partners` (030 §4): bayi kaydı ve `partner_code`. RLS K (katalog): kiracısız, çalışma zamanı
// rollerine yazma yetkisi yok. auth şemasındaki organizations.partner_code buna FK olduğundan auth tablolarıyla
// aynı migrasyonda kurulur. `name` harmanlaması (tr-TR-x-icu) migrasyonda yamadır (030 §14).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const partners = appSchema.table(
  'partners',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    // V1.1 (komisyon); baz puan, %20 = 2000.
    commissionRateBp: integer('commission_rate_bp'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('partners_code_uq').on(t.code),
    check('partners_code_chk', sql`${sql.identifier('code')} ~ '^[A-Z0-9-]{4,32}$'`),
    check(
      'partners_contact_email_chk',
      sql`${sql.identifier('contact_email')} = lower(${sql.identifier('contact_email')})`,
    ),
    check(
      'partners_commission_rate_bp_chk',
      sql`${sql.identifier('commission_rate_bp')} BETWEEN 0 AND 10000`,
    ),
  ],
);

export type Partner = typeof partners.$inferSelect;
