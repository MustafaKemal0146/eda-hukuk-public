// Başsız ProseMirror şeması (054 §1.3): DOM olmadan Node'da çalışır; api/worker otoriter doğrulaması
// ve tarayıcı ön doğrulaması aynı şemayı kullanır.
import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { buildEditorExtensions } from './extensions.ts';

let cached: Schema | undefined;

export function getEditorSchema(): Schema {
  cached ??= getSchema(buildEditorExtensions({ headless: true }));
  return cached;
}
