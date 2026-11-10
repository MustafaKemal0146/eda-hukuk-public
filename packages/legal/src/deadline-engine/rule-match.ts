// Kural eşleme (083 §7.1, §7.2; P22 K13). `calculate_deadline` aracının `action` metni kural koduna
// takma adlarla eşlenir; model kural kodu yazmaz ve tahmin etmez. Karşılaştırma `tr_fold` iledir
// (Y-104). Belirsizlikte (eşitlik veya skor 0) aday listesi döner; çağıran `TOOL_INVALID_INPUT` üretir.
import type { DeadlineBranch, FileDocType } from '@eda/contracts/enums';
import { tr_fold } from '../text/index.ts';
import type { DeadlineRuleRecordValue } from './params.ts';

export const ALIAS_SCORE_EXACT = 100;
export const ALIAS_SCORE_CONTAINS = 50;

export type RuleMatch =
  | { readonly status: 'matched'; readonly rule: DeadlineRuleRecordValue; readonly score: number }
  | {
      readonly status: 'ambiguous' | 'not_found';
      /** En yüksek skorlu adaylar (eşitlikte birden çok; skor 0'da dal içindeki tüm kurallar). */
      readonly candidates: readonly { code: string; title: string }[];
    };

function fold(text: string): string {
  return tr_fold(text).replace(/\s+/g, ' ').trim();
}

/** Takma ad, eylem metninde sözcük sınırlarıyla geçiyor mu. */
function containsPhrase(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return false;
    const before = i === 0 ? ' ' : haystack.charAt(i - 1);
    const after = i + needle.length >= haystack.length ? ' ' : haystack.charAt(i + needle.length);
    if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true;
    from = i + 1;
  }
}

export function aliasScore(action: string, alias: string): number {
  const a = fold(action);
  const b = fold(alias);
  if (a === b) return ALIAS_SCORE_EXACT;
  return containsPhrase(a, b) ? ALIAS_SCORE_CONTAINS : 0;
}

/**
 * `action` + `branch` -> kural. Yalnız verilen (seçilebilir) kurallar adaydır; çağıran prod'da
 * yalnız doğrulanmış kuralları verir (083 §7.1, K13). Kural skoru takma adlarının en yükseğidir.
 */
export function resolveRuleByAlias(
  action: string,
  branch: DeadlineBranch,
  rules: readonly DeadlineRuleRecordValue[],
): RuleMatch {
  const inBranch = rules.filter((r) => r.branch === branch);
  let best = 0;
  let top: DeadlineRuleRecordValue[] = [];
  for (const r of inBranch) {
    let score = 0;
    for (const alias of r.params.aliases) score = Math.max(score, aliasScore(action, alias));
    if (score > best) {
      best = score;
      top = [r];
    } else if (score === best && score > 0) {
      top.push(r);
    }
  }
  const brief = (list: readonly DeadlineRuleRecordValue[]) =>
    list.map((r) => ({ code: r.code, title: r.title }));
  if (best === 0) return { status: 'not_found', candidates: brief(inBranch) };
  const [only] = top;
  if (top.length === 1 && only !== undefined) return { status: 'matched', rule: only, score: best };
  return { status: 'ambiguous', candidates: brief(top) };
}

/** 083 §7.2: evrak türü -> kural kodu adayları (tablo sırası). Listede olmayan tür aday üretmez. */
export const DOC_TYPE_RULE_CANDIDATES: Readonly<Partial<Record<FileDocType, readonly string[]>>> = {
  petition: ['hmk_cevap_dilekcesi'],
  decision: [
    'hmk_istinaf_basvuru',
    'hmk_temyiz_basvuru',
    'iyuk_istinaf',
    'iyuk_temyiz',
    'cmk_istinaf',
    'cmk_temyiz',
  ],
  interim_decision: ['hmk_ihtiyati_tedbir_itiraz', 'iik_ihtiyati_haciz_itiraz'],
  expert_report: ['hmk_bilirkisi_raporuna_itiraz'],
  service_notice: ['iik_odeme_emrine_itiraz', 'iik_imzaya_itiraz', 'iyuk_dava_acma_idare'],
};

/**
 * Evrak Kartı kural adayları (P22 K10). Yalnız verilen seçilebilir kurallar arasından; `branch`
 * verilirse yargı koluna göre süzülür. Öneri hesap değildir: süre veya tarih üretmez.
 */
export function candidatesForDocType(
  docType: FileDocType,
  branch: DeadlineBranch | null,
  selectable: readonly DeadlineRuleRecordValue[],
): string[] {
  const codes = DOC_TYPE_RULE_CANDIDATES[docType] ?? [];
  const byCode = new Map(selectable.map((r) => [r.code, r]));
  return codes.filter((c) => {
    const r = byCode.get(c);
    return r !== undefined && (branch === null || r.branch === branch);
  });
}
