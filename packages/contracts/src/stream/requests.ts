// Sohbet turu istek sözleşmeleri (022 §2). JSON alanları camelCase; sunucu ek kuralları superRefine'da.
import { z } from 'zod';
import { CONFIG_DEFAULTS } from '../config/defaults.ts';
import { SOURCE_CODES } from '../enums.ts';
import { COURT_TYPES } from '../tools/common.ts';

export const MODEL_ALIASES = ['edai-flash', 'edai-pro'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const CHAT_MODES = ['chat', 'petition'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

const UserTextPart = z.object({ type: z.literal('text'), text: z.string().min(1) });

export const ChatTurnRequest = z
  .object({
    trigger: z.enum(['submit-message', 'regenerate-message']),
    message: z
      .object({
        id: z.uuid(),
        role: z.literal('user'),
        parts: z.tuple([UserTextPart]),
      })
      .nullable(),
    regenerateMessageId: z.uuid().nullable(),
    /**
     * Kullanıcı mesajını düzenleyip yeniden gönderme: bu kimlikli kullanıcı mesajı ve sonrasındaki
     * TÜM mesajlar transkriptten düşer, `message` yeni tur olarak yazılır (kredi/kota yeni tur gibi).
     * Yalnız `submit-message` ile; alan yoksa `null` (geriye uyumlu).
     */
    replaceFromMessageId: z.uuid().nullable().default(null),
    alias: z.enum(MODEL_ALIASES),
    mode: z.enum(CHAT_MODES),
    scope: z.object({
      sources: z.array(z.enum(SOURCE_CODES)),
      /** P12 K5: `null` = hepsi, `[]` = karar kaynağı yok; alan yoksa `null` (geriye uyumlu). */
      courtTypes: z.array(z.enum(COURT_TYPES)).max(COURT_TYPES.length).nullable().default(null),
      chamber: z.string().nullable(),
      dateFrom: z.iso.date().nullable(),
      dateTo: z.iso.date().nullable(),
    }),
    attachments: z.array(z.uuid()),
    mentions: z.array(z.uuid()),
    documentId: z.uuid().nullable(),
    documentBaseVersion: z.number().int().nonnegative().nullable(),
    liveSearch: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const submit = v.trigger === 'submit-message';
    if (submit !== (v.message !== null) || (submit && v.regenerateMessageId !== null)) {
      ctx.addIssue({ code: 'custom', path: ['trigger'], message: 'trigger_message_mismatch' });
    }
    if (!submit && v.replaceFromMessageId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['replaceFromMessageId'],
        message: 'replace_requires_submit',
      });
    }
    const text = v.message?.parts[0].text ?? '';
    if (text.length > CONFIG_DEFAULTS['chat.maxUserMessageChars']) {
      ctx.addIssue({ code: 'custom', path: ['message'], message: 'message_too_long' });
    }
    if (v.attachments.length > CONFIG_DEFAULTS['chat.maxAttachmentsPerMessage']) {
      ctx.addIssue({ code: 'custom', path: ['attachments'], message: 'too_many_attachments' });
    }
    if (v.mentions.length > CONFIG_DEFAULTS['chat.maxMentionsPerMessage']) {
      ctx.addIssue({ code: 'custom', path: ['mentions'], message: 'too_many_mentions' });
    }
    if (v.documentId !== null && v.documentBaseVersion === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['documentBaseVersion'],
        message: 'base_version_required',
      });
    }
  });
export type ChatTurnRequest = z.infer<typeof ChatTurnRequest>;

export const ChatStopRequest = z.object({ messageId: z.uuid() }).strict();
export type ChatStopRequest = z.infer<typeof ChatStopRequest>;
