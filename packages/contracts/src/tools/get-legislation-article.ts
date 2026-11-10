// get_legislation_article (021 §4.6).
import { z } from 'zod';
import { CONFIG_DEFAULTS } from '../config/defaults.ts';
import { LawNo, SourceRef, type ToolContract, TrDate } from './common.ts';

export const GetLegislationArticleInput = z
  .object({
    ref: SourceRef.nullable().describe('Kaynak etiketi (ör. K5) veya null.'),
    law_no: LawNo.nullable().describe('Kanun numarası (ör. 6098) veya null.'),
    article_no: z
      .string()
      .nullable()
      .describe("Madde: '49', '344/A', 'Geçici 1' ya da '344-346'; veya null."),
    as_of: TrDate.nullable().describe('Yürürlük tarihi (GG.AA.YYYY) veya null: güncel.'),
  })
  .strict();
export type GetLegislationArticleInput = z.infer<typeof GetLegislationArticleInput>;

export const getLegislationArticle: ToolContract<typeof GetLegislationArticleInput> = {
  name: 'get_legislation_article',
  description:
    "Kanun maddesinin metnini getirir: ref ya da law_no + article_no. Aralık için '344-346' (en çok 5 madde). as_of verilirse o tarihteki metin; geçmiş sürüm yoksa güncel metin ve uyarı döner.",
  inputSchema: GetLegislationArticleInput,
  serverRules: (i) => {
    if (i.ref === null && (i.law_no === null || i.article_no === null)) {
      return 'ref veya law_no + article_no verilmeli.';
    }
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(i.article_no ?? '');
    if (range) {
      const span = Number(range[2]) - Number(range[1]) + 1;
      if (span < 1 || span > CONFIG_DEFAULTS['tools.articleRangeMax']) {
        return "Madde aralığı en çok 5 madde olabilir; örnek: '344-348'.";
      }
    }
    return null;
  },
};
