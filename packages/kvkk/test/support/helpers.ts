// Test yardımcıları: sözlük derleme ve tek segment maskeleme kısayolları (veri sentetik).
import { compileDictionary } from '../../src/dictionary/compile.ts';
import { sourcesFromInput } from '../../src/dictionary/from-input.ts';
import { mask } from '../../src/mask.ts';
import { deriveConvKey } from '../../src/tokens/derive.ts';
import type {
  CompiledDictionary,
  DictionaryInput,
  MaskResult,
  MaskSegment,
  OriginKind,
} from '../../src/types.ts';
import { nodeCryptoPort, TEST_KEY, TEST_SCOPE } from './node-crypto-port.ts';

export const K_CONV = deriveConvKey(nodeCryptoPort, TEST_KEY, TEST_SCOPE);

export function dictOf(
  input: Partial<DictionaryInput>,
  maskOwnCaseNumber = true,
): CompiledDictionary {
  const full: DictionaryInput = { clients: [], parties: [], cases: [], ...input };
  return compileDictionary(sourcesFromInput(full, { maskOwnCaseNumber }), {
    crypto: nodeCryptoPort,
  });
}

export function maskSegments(
  segments: MaskSegment[],
  dictionary: CompiledDictionary | null = null,
  opts: { maskOwnCaseNumber?: boolean; tokenHashChars?: 4 | 6 } = {},
): MaskResult {
  return mask({
    segments,
    convKey: K_CONV,
    dictionary,
    options: {
      tokenHashChars: opts.tokenHashChars ?? 4,
      maskOwnCaseNumber: opts.maskOwnCaseNumber ?? true,
    },
    crypto: nodeCryptoPort,
  });
}

export function maskOne(
  text: string,
  dictionary: CompiledDictionary | null = null,
  origin: OriginKind = 'user_text',
): MaskResult {
  return maskSegments([{ id: 's1', text, origin }], dictionary);
}

export function maskedText(
  text: string,
  dictionary: CompiledDictionary | null = null,
  origin: OriginKind = 'user_text',
): string {
  return maskOne(text, dictionary, origin).segments[0]?.text ?? '';
}

/** Ahmet Yılmaz örnek müvekkili (sentetik; TCKN 026 §4.6 vektörü). */
export const AHMET: DictionaryInput = {
  clients: [
    {
      id: 'c-ahmet',
      kind: 'person',
      firstName: 'Ahmet',
      lastName: 'Yılmaz',
      tckn: '10000000146',
      email: 'ahmet@example.com',
      phone: '0532 123 45 67',
    },
  ],
  parties: [],
  cases: [],
};
