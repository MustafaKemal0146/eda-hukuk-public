// Editör belge modelinin dış sınır şekilleri (054 §2.6, §3). Bilerek gevşektir: derin doğrulama
// `@eda/editor` içinde şema (`Node.fromJSON` + `check()`) ve `validateDoc` ile yapılır. Öznitelik
// nesneleri `looseObject`tir: izin dışı öznitelik burada sessizce atılmaz, doğrulayıcı raporlar (054 §2.8).
import { z } from 'zod';
import { SECTION_ROLES } from './enums.ts';

/** `b-` + 6 karakter Crockford base32 (054 §3.1). */
export const BLOCK_ID_PATTERN = /^b-[0-9A-HJKMNP-TV-Z]{6}$/;

export const BlockId = z.string().regex(BLOCK_ID_PATTERN);
export type BlockIdValue = z.infer<typeof BlockId>;

export const SectionRoleSchema = z.enum(SECTION_ROLES);

/** Üst düzey blok: tek düğüm tipi `section` (054 §2.1). `rev` sunucuya aittir (§3.2). */
export const TipTapSection = z.object({
  type: z.literal('section'),
  attrs: z.looseObject({
    blockId: BlockId,
    rev: z.number().int().min(0),
    role: SectionRoleSchema,
  }),
  content: z.array(z.unknown()).min(1),
});
export type TipTapSectionJson = z.infer<typeof TipTapSection>;

/** Belge kökü: `doc` -> `section+` (054 §2.6; içerik derin doğrulanmaz). */
export const TipTapDoc = z.looseObject({
  type: z.literal('doc'),
  content: z.array(z.unknown()),
});
export type TipTapDocJson = z.infer<typeof TipTapDoc>;
