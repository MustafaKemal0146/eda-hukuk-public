// edit_document (021 §4.10).
import { z } from 'zod';
import { EDIT_OP_TYPES } from '../enums.ts';
import { SectionRole, SourceRef, type ToolContract } from './common.ts';

export const EditOp = z
  .object({
    type: z
      .enum(EDIT_OP_TYPES)
      .describe('replace_block, insert_after, delete_block, replace_text.'),
    block_id: z.string().describe('Hedef blok kimliği.'),
    role: SectionRole.nullable().describe(
      'Yalnız insert_after: yeni bölümün rolü; diğerlerinde null.',
    ),
    content: z.string().nullable().describe('Yeni metin (replace_block, insert_after) veya null.'),
    find: z.string().nullable().describe('replace_text: aranan ifade; diğerlerinde null.'),
    replace: z.string().nullable().describe('replace_text: yeni ifade; diğerlerinde null.'),
    occurrence: z
      .number()
      .int()
      .min(1)
      .nullable()
      .describe("replace_text: kaçıncı geçiş (1'den) veya null."),
    reason: z.string().describe('Kısa gerekçe.'),
    source_refs: z.array(SourceRef).nullable().describe('Dayanak kaynak etiketleri veya null.'),
  })
  .strict();

export const EditDocumentInput = z
  .object({ ops: z.array(EditOp).describe('Düzenleme işlemleri (sırayla uygulanır).') })
  .strict();

export const editDocument: ToolContract<typeof EditDocumentInput> = {
  name: 'edit_document',
  description:
    'Açık belgede blok bazlı düzenleme önerileri üretir; avukat kabul veya reddeder. block_id değerlerini belge bağlamından al; her işleme kısa gerekçe yaz. İçtihat atfı yalnız [K#] ile.',
  inputSchema: EditDocumentInput,
  serverRules: (i) => (i.ops.length < 1 || i.ops.length > 20 ? 'ops 1-20 işlem olmalı.' : null),
};
