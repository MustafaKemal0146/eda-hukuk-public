// Hassas konu algısı `sensitiveTopic` (026 §7.7): kök sözcükler katlanmış metinde sözcük başı
// eşleşmesiyle aranır (en çok 8 harf ek payı). Veri sınıfını DÜŞÜRMEZ (Y-24); yalnız yerleşim
// yükseltme ve Genel araştırma engeli içindir.
import { SENSITIVE_TOPIC_CODES } from '@eda/contracts/enums';
import { TOPIC_LEXICON } from '../data/topic-lexicon.tr.ts';
import { buildScan, normalizeText } from '../normalize.ts';
import type { SensitiveTopicCode } from '../types.ts';
import { Lexicon } from './lexicon.ts';

const LEXICON = new Lexicon(TOPIC_LEXICON.map((t) => t.root));

export function sensitiveTopic(text: string): SensitiveTopicCode[] {
  const scan = buildScan(normalizeText(text));
  const found = new Set<SensitiveTopicCode>();
  for (const h of LEXICON.scan(scan.fold)) {
    const entry = TOPIC_LEXICON[h.term];
    if (entry) found.add(entry.code);
  }
  return SENSITIVE_TOPIC_CODES.filter((c) => found.has(c));
}
