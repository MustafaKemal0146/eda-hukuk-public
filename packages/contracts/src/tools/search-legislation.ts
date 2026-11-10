// search_legislation (021 §4.5).
import { z } from 'zod';
import { LawNo, type ToolContract } from './common.ts';

export const SearchLegislationInput = z
  .object({
    query: z.string().describe("Arama ifadesi, ör. 'kira bedelinin tespiti'."),
    law_no: LawNo.nullable().describe('Kanun numarası (ör. 6098) veya null.'),
  })
  .strict();
export type SearchLegislationInput = z.infer<typeof SearchLegislationInput>;

export const searchLegislation: ToolContract<typeof SearchLegislationInput> = {
  name: 'search_legislation',
  description:
    "Yürürlükteki mevzuat maddelerinde arama (güncel metin). Sonuçlar [K#] etiketi taşır; madde atfını 'TBK m. 49' biçiminde yazabilirsin. Kanun numarası biliniyorsa law_no ver.",
  inputSchema: SearchLegislationInput,
  serverRules: (i) => {
    const q = i.query.trim();
    return q.length < 2 || q.length > 300 ? 'query 2-300 karakter olmalı.' : null;
  },
};
