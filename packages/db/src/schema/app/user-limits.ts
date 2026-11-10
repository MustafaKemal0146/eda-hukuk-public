// Kullanıcı bazlı limit geçersiz kılmaları (yönetim paneli "Kullanıcılar" modülü). Satır yoksa veya
// kolon NULL ise varsayılan `config/defaults` zinciri (`limits.user.*`) geçerlidir. RLS E (kullanıcı
// kapsamlı): kişi yalnız kendi satırını okur; yazma yalnız `app.admin_set_user_limits()` ile yapılır.
// Platform ve büro limitleri ayrı tablodadır (bu tabloya karışmaz).
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, uuid } from 'drizzle-orm/pg-core';
import { col, createdAt, updatedAt } from '../_columns.ts';
import { users } from '../auth.ts';
import { appSchema } from './partners.ts';

const nonNegative = (name: string) => sql`${col(name)} IS NULL OR ${col(name)} >= 0`;

export const userLimitOverrides = appSchema.table(
  'user_limit_overrides',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatTurnsPerDay: integer('chat_turns_per_day'),
    chatTurnsPerMonth: integer('chat_turns_per_month'),
    tokensPerDay: bigint('tokens_per_day', { mode: 'number' }),
    tokensPerMonth: bigint('tokens_per_month', { mode: 'number' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('user_limit_overrides_chat_day_chk', nonNegative('chat_turns_per_day')),
    check('user_limit_overrides_chat_month_chk', nonNegative('chat_turns_per_month')),
    check('user_limit_overrides_tokens_day_chk', nonNegative('tokens_per_day')),
    check('user_limit_overrides_tokens_month_chk', nonNegative('tokens_per_month')),
    index('user_limit_overrides_updated_by_idx')
      .on(t.updatedBy)
      .where(sql`${col('updated_by')} IS NOT NULL`),
  ],
);

export type UserLimitOverrides = typeof userLimitOverrides.$inferSelect;
