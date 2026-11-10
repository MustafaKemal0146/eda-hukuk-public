// Egress bekçisi (020 §9.1): her aday çağrısından hemen önce (a) istemin maskeleme ara katmanının
// markasını taşıdığını, (b) istemde sözlük/sıkı yapısal değer ve tablosuz token bulunmadığını doğrular.
// Biri başarısızsa çağrı yapılmaz: KVKK_MASKING_FAILED. Katman [1] ve araç tanımları taranmaz.
import type { LanguageModelV4CallOptions, LanguageModelV4Middleware } from '@ai-sdk/provider';
import { type MaskerPort, MaskingDenied, maskedTurnOf } from './masking.ts';

export function egressGuardMiddleware(masker: MaskerPort): LanguageModelV4Middleware {
  return {
    specificationVersion: 'v4',
    transformParams: async ({ params }): Promise<LanguageModelV4CallOptions> => {
      const turn = maskedTurnOf(params.prompt);
      if (!turn) throw new MaskingDenied('UNBRANDED');
      let ok = false;
      try {
        ok = masker.verify(params.prompt, turn);
      } catch {
        ok = false;
      }
      if (!ok) throw new MaskingDenied('VERIFY_FAILED');
      return params;
    },
  };
}
