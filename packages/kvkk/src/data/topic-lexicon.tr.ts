// Hassas konu sözlükçesi (026 §7.7). Hukuk onayı bekliyor.
// Başlangıç sürümü YALNIZ plan belgelerinde adı geçen kavramlarla sınırlıdır (026 §7.7):
// ceza davası/sanık/şüpheli/tutuklama; velayet/çocuk; boşanma/nafaka; sağlık Seviye A; iltica/sığınma/
// mülteci; ticari sır; halka arz/SPK. Sağlık kökleri SAGLIK sözlükçesinden alınır.
import type { SensitiveTopicCode } from '../types.ts';
import { HEALTH_LEXICON } from './health-lexicon.tr.ts';

export const TOPIC_LEXICON: readonly { root: string; code: SensitiveTopicCode }[] = [
  { root: 'ceza davası', code: 'criminal' },
  { root: 'sanık', code: 'criminal' },
  { root: 'şüpheli', code: 'criminal' },
  { root: 'tutuklama', code: 'criminal' },
  { root: 'velayet', code: 'child' },
  { root: 'çocuk', code: 'child' },
  { root: 'boşanma', code: 'family' },
  { root: 'nafaka', code: 'family' },
  ...HEALTH_LEXICON.map((root) => ({ root, code: 'health' as const })),
  { root: 'iltica', code: 'asylum_migration' },
  { root: 'sığınma', code: 'asylum_migration' },
  { root: 'mülteci', code: 'asylum_migration' },
  { root: 'ticari sır', code: 'trade_secret' },
  { root: 'halka arz', code: 'capital_markets' },
  { root: 'SPK', code: 'capital_markets' },
];
