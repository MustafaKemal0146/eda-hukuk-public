// submit_outline (021 §4.11).
import { z } from 'zod';
import { DocumentKind, SectionRole, SourceRef, type ToolContract } from './common.ts';

export const OutlineSection = z
  .object({
    role: SectionRole,
    heading: z.string().describe('Bölüm başlığı.'),
    intent: z.string().describe('Bu bölümde ne yazılacağı (1-2 cümle).'),
    source_refs: z.array(SourceRef).nullable().describe('Dayanak kaynak etiketleri veya null.'),
  })
  .strict();

export const SubmitOutlineInput = z
  .object({
    kind: DocumentKind.describe('petition=dilekçe, notice=ihtarname, memo=mütalaa, free=serbest.'),
    subtype: z.string().nullable().describe("Alt tür, ör. 'cevap dilekçesi', veya null."),
    court: z.string().nullable().describe('Mahkeme/merci adı veya null.'),
    subject: z.string().describe('Belgenin konusu (tek cümle).'),
    sections: z.array(OutlineSection).describe('Bölüm planı (sırayla).'),
    questions: z
      .array(z.string())
      .describe('Kullanıcıya sorulacak eksik bilgiler (yoksa boş dizi).'),
  })
  .strict();

export const submitOutline: ToolContract<typeof SubmitOutlineInput> = {
  name: 'submit_outline',
  description:
    'Dilekçe modunun ilk adımı: belge planını gönder. Plan kullanıcıya düzenlenebilir gösterilir. partiesGrid ve attorneySignature bölümlerinin metnini yazma, yalnız listele. Eksik bilgileri questions ile sor.',
  inputSchema: SubmitOutlineInput,
  serverRules: (i) =>
    i.sections.length < 1 || i.sections.length > 20 || i.questions.length > 10
      ? 'sections 1-20, questions en çok 10 olmalı.'
      : null,
};
