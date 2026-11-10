// Maskeleme ara katmanı (020 §9.1, 022 §3.6, 026 §7.8): transformParams tüm sağlayıcı yükünü tek
// geçişte maskeler (katman [1] ve araç tanımları hariç) ve çıktıyı süreç içi markayla işaretler;
// wrapStream metin parçalarını parça kimliği başına tamponla geri çözer, tamamlanmış araç girdisini
// argsPolicy'ye göre dönüştürür (tek sahip bu adaptördür; yürütücüde ikinci dönüşüm yok). Hata =
// fail-closed: KVKK_MASKING_FAILED, sağlayıcı çağrısı yapılmaz. Maskeleme kapatılamaz.
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4Middleware,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';

export const KVKK_MASKING_FAILED = 'KVKK_MASKING_FAILED' as const;

/** Maskeleme/egress hatası; gateway katmanında GatewayDenied ile aynı biçim (kod taşır, içerik yok). */
export class MaskingDenied extends Error {
  readonly code = KVKK_MASKING_FAILED;
  /** İç neden kodu (KvkkMaskingError.code); içerik taşımaz. */
  readonly reason: string;
  constructor(reason: string) {
    super(KVKK_MASKING_FAILED);
    this.name = 'MaskingDenied';
    this.reason = reason;
  }
}

export interface StreamUnmaskerPort {
  push(partId: string, delta: string): string;
  end(partId: string): string;
  endAll(): Record<string, string>;
}

/** Bir sağlayıcı çağrısının maskelenmiş istemi ve o çağrıya ait geri çözme yetenekleri. */
export interface MaskedTurn {
  readonly prompt: LanguageModelV4Prompt;
  /** Bu çağrıda maskelenen span sayısı (masked_count; içerik yok). */
  readonly maskedCount: number;
  createUnmasker(): StreamUnmaskerPort;
  unmaskText(text: string): string;
  /** Tamamlanmış araç girdisi (JSON dizesi) argsPolicy'ye göre dönüştürülür. */
  transformToolInput(toolName: string, input: string): string;
}

export interface MaskerPort {
  /** Hata fırlatırsa çağrı yapılmaz (fail-closed). */
  mask(prompt: LanguageModelV4Prompt): MaskedTurn;
  /** Egress doğrulaması: istemde sözlük/sıkı yapısal değer veya tablosuz token yok. */
  verify(prompt: LanguageModelV4Prompt, turn: MaskedTurn): boolean;
}

/** Fail-closed varsayılan: gerçek maskeleyici kurulmadıkça hiçbir istem sağlayıcıya gitmez. */
export class NullMasker implements MaskerPort {
  mask(): MaskedTurn {
    throw new MaskingDenied('MASKER_NOT_CONFIGURED');
  }

  verify(): boolean {
    return false;
  }
}

/** Süreç içi marka (020 §9.1 MASKED): yalnız maskeleme ara katmanının ürettiği istemler. */
const MASKED = new WeakMap<LanguageModelV4Prompt, MaskedTurn>();

export function maskedTurnOf(prompt: LanguageModelV4Prompt): MaskedTurn | undefined {
  return MASKED.get(prompt);
}

function wrapUnmasker(u: StreamUnmaskerPort, onError: () => void): StreamUnmaskerPort {
  // Geri çözme güvenlik kapısı değildir: iç istisnada parça alındığı gibi (maskeli) iletilir (026 §12.4).
  return {
    push(id, delta) {
      try {
        return u.push(id, delta);
      } catch {
        onError();
        return delta;
      }
    },
    end(id) {
      try {
        return u.end(id);
      } catch {
        onError();
        return '';
      }
    },
    endAll() {
      try {
        return u.endAll();
      } catch {
        onError();
        return {};
      }
    },
  };
}

export function maskingMiddleware(masker: MaskerPort): LanguageModelV4Middleware {
  return {
    specificationVersion: 'v4',
    transformParams: async ({ params }): Promise<LanguageModelV4CallOptions> => {
      let turn: MaskedTurn;
      try {
        turn = masker.mask(params.prompt);
      } catch (e) {
        if (e instanceof MaskingDenied) throw e;
        const code = (e as { code?: unknown }).code;
        throw new MaskingDenied(typeof code === 'string' ? code : 'INTERNAL');
      }
      MASKED.set(turn.prompt, turn);
      return { ...params, prompt: turn.prompt };
    },
    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate();
      const turn = MASKED.get(params.prompt);
      if (!turn) return result;
      const content: LanguageModelV4Content[] = result.content.map((c) => {
        if (c.type === 'text') return { ...c, text: turn.unmaskText(c.text) };
        if (c.type === 'tool-call')
          return { ...c, input: turn.transformToolInput(c.toolName, c.input) };
        return c;
      });
      return { ...result, content };
    },
    wrapStream: async ({ doStream, params }) => {
      const result = await doStream();
      const turn = MASKED.get(params.prompt);
      if (!turn) throw new MaskingDenied('UNBRANDED');
      const u = wrapUnmasker(turn.createUnmasker(), () => undefined);
      const flushAll = (
        controller: TransformStreamDefaultController<LanguageModelV4StreamPart>,
      ) => {
        for (const [id, rest] of Object.entries(u.endAll())) {
          if (rest) controller.enqueue({ type: 'text-delta', id, delta: rest });
        }
      };
      const transform = new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
        transform(chunk, controller) {
          // Reasoning maskeli kalır: arayüze gitmez, imzasıyla aynen geri gönderilir (P07d).
          if (chunk.type === 'text-delta') {
            const delta = u.push(chunk.id, chunk.delta);
            if (delta) controller.enqueue({ ...chunk, delta });
            return;
          }
          if (chunk.type === 'text-end') {
            const rest = u.end(chunk.id);
            if (rest) controller.enqueue({ type: 'text-delta', id: chunk.id, delta: rest });
            controller.enqueue(chunk);
            return;
          }
          if (chunk.type === 'tool-call') {
            controller.enqueue({
              ...chunk,
              input: turn.transformToolInput(chunk.toolName, chunk.input),
            });
            return;
          }
          if (chunk.type === 'finish' || chunk.type === 'error') flushAll(controller);
          controller.enqueue(chunk);
        },
        flush(controller) {
          flushAll(controller);
        },
      });
      return { ...result, stream: result.stream.pipeThrough(transform) };
    },
  };
}
