// calculate_deadline (021 §4.8).
import { z } from 'zod';
import { DeadlineBranch, ServiceMethod, StartEvent, type ToolContract, TrDate } from './common.ts';

export const CalculateDeadlineInput = z
  .object({
    branch: DeadlineBranch.describe('Yargı kolu.'),
    action: z.string().describe("Süre konusu işlem, ör. 'istinaf', 'cevap dilekçesi'."),
    start_event: StartEvent.describe('service=tebliğ, pronouncement=tefhim, learning=öğrenme.'),
    start_date: TrDate.describe('Olay tarihi (GG.AA.YYYY).'),
    service_method: ServiceMethod.nullable().describe(
      'Tebliğ yolu: postal veya e_tebligat; null: bilinmiyor.',
    ),
  })
  .strict();

export const calculateDeadline: ToolContract<typeof CalculateDeadlineInput> = {
  name: 'calculate_deadline',
  description:
    "Usul süresini süre motoruyla hesaplar (resmî ve adli tatil dahil). Süreyi kendin hesaplama; yanıtta yalnız bu sonucu kullan. Sonuç kullanıcıya 'Takvime ekle' önerisi olarak gösterilir, takvime yazılmaz.",
  inputSchema: CalculateDeadlineInput,
  serverRules: (i) =>
    i.action.trim().length < 2 || i.action.length > 120 ? 'action 2-120 karakter olmalı.' : null,
};
