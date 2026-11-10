// Mesaj meta verisi (022 §5.3): asistan rozeti + tur durumu; kullanıcı mesajı bağlamı.
import { z } from 'zod';
import { CHAT_MODES, MODEL_ALIASES } from './requests.ts';

export const MESSAGE_STATUSES = [
  'streaming',
  'complete',
  'stopped',
  'error',
  'interrupted',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MessageMetadata = z.object({
  alias: z.enum(MODEL_ALIASES).optional(),
  providerId: z.string().optional(),
  region: z.enum(['TR', 'EU', 'US', 'CN', 'NONE']).optional(),
  modelLabel: z.string().optional(),
  dataClass: z.enum(['public', 'client', 'case']).optional(),
  thinking: z.enum(['off', 'low', 'medium', 'high']).optional(),
  status: z.enum(MESSAGE_STATUSES).optional(),
  errorCode: z.string().optional(),
  requestId: z.string().optional(),
  mode: z.enum(CHAT_MODES).optional(),
  attachments: z.array(z.uuid()).optional(),
  mentions: z.array(z.uuid()).optional(),
  /** Turda kullanılan API anahtarının kaynağı (#54; `platform` = sunucunun ortak anahtarı). */
  keySource: z.enum(['org', 'own', 'platform']).optional(),
  /** Tur başlangıç zamanı (ms, epoch): istemci süre gösterimi için. */
  startedAt: z.number().int().optional(),
});
export type MessageMetadata = z.infer<typeof MessageMetadata>;
