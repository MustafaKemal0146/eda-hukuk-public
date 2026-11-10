// search_decisions (021 §4.3).
import { z } from 'zod';
import { CONFIG_DEFAULTS } from '../config/defaults.ts';
import { CourtTypeSchema, EsasNo, type ToolContract, TrDate } from './common.ts';

export const SearchDecisionsInput = z
  .object({
    query: z.string().describe('Kısa hukuki arama ifadesi; tam ifade için çift tırnak.'),
    court_types: z
      .array(CourtTypeSchema)
      .nullable()
      .describe('Mahkeme türleri; null: kapsamdaki tümü.'),
    chamber: z
      .string()
      .nullable()
      .describe('Daire kodu: H9, C4, D10, HGK, CGK, IDDK, VDDK; null: tümü.'),
    date_from: TrDate.nullable().describe('Karar tarihi alt sınırı (GG.AA.YYYY) veya null.'),
    date_to: TrDate.nullable().describe('Karar tarihi üst sınırı (GG.AA.YYYY) veya null.'),
    esas_no: EsasNo.nullable().describe("Belirli kararın esas no'su (YYYY/N) veya null."),
    karar_no: EsasNo.nullable().describe("Belirli kararın karar no'su (YYYY/N) veya null."),
    live: z.boolean().describe('Yalnız kullanıcı resmî kaynakta aramayı istediyse true.'),
    page: z.number().int().min(1).nullable().describe("Sayfa (1'den başlar) veya null."),
  })
  .strict();
export type SearchDecisionsInput = z.infer<typeof SearchDecisionsInput>;

function parseTr(d: string): number {
  const [g, a, y] = d.split('.').map(Number);
  return Date.UTC(y ?? 0, (a ?? 1) - 1, g ?? 1);
}

export const searchDecisions: ToolContract<typeof SearchDecisionsInput> = {
  name: 'search_decisions',
  description:
    'Yargı kararlarında arama: önce yerel korpus, gerekirse resmî kaynak. Her sonuç [K3] gibi etiket taşır; içtihada yalnız bu etiketle atıf yap, künye yazma. Kısa hukuki ifade kullan; tam ifade için çift tırnak. Kişisel veri (ad, T.C. no, dosya no) yazma. Metin için get_decision.',
  inputSchema: SearchDecisionsInput,
  serverRules: (i) => {
    const q = i.query.trim();
    // Numara ile doğrudan erişimde (esas_no / karar_no) sorgu metni kaynakta kullanılmaz; boş olabilir.
    const byNumber = i.esas_no !== null || i.karar_no !== null;
    if (q.length > CONFIG_DEFAULTS['tools.queryMaxChars'])
      return 'query en çok 300 karakter olabilir.';
    if (!byNumber && (q.length < 2 || !/\p{L}/u.test(q))) {
      return 'query 2-300 karakter olmalı ve en az bir harf içermeli.';
    }
    if (i.court_types && (i.court_types.length < 1 || i.court_types.length > 8)) {
      return 'court_types 1-8 eleman olmalı veya null.';
    }
    if (i.date_from && i.date_to && parseTr(i.date_from) > parseTr(i.date_to)) {
      return "date_from, date_to'dan sonra olamaz.";
    }
    if (i.page !== null && i.page > 20) return 'page en çok 20 olabilir.';
    return null;
  },
};
