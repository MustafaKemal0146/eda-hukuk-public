// create_document (021 §4.9).
import { z } from 'zod';
import { DocumentKind, SourceRef, type ToolContract } from './common.ts';

export const CreateDocumentInput = z
  .object({
    kind: DocumentKind.describe('petition=dilekçe, notice=ihtarname, memo=mütalaa, free=serbest.'),
    subtype: z.string().nullable().describe("Alt tür, ör. 'istinaf dilekçesi', veya null."),
    instructions: z.string().describe('Talebin ve önemli olguların kısa özeti.'),
    source_refs: z
      .array(SourceRef)
      .nullable()
      .describe('Kullanılacak kaynak etiketleri veya null.'),
    responds_to_ref: SourceRef.nullable().describe('Cevap verilecek evrakın etiketi veya null.'),
  })
  .strict();

export const createDocument: ToolContract<typeof CreateDocumentInput> = {
  name: 'create_document',
  description:
    'Yeni belge taslağı başlatır (dilekçe, ihtarname, mütalaa, serbest). Önce düzenlenebilir plan kullanıcıya sunulur; metin onaydan sonra yazılır. Kullanıcı açıkça belge istemediyse önce sor.',
  inputSchema: CreateDocumentInput,
  serverRules: (i) =>
    i.instructions.trim().length < 10 || i.instructions.length > 4000
      ? 'instructions 10-4000 karakter olmalı.'
      : null,
};
