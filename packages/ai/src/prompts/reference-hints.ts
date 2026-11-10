// Doğrudan atıf yönlendirmesi: kullanıcı mesajında karar numarası ("2023/1234 E., 2024/567 K.") veya
// madde atfı ("TBK 125") varsa TUR BAĞLAMI'na sunucu notu eklenir; model konu araması yapmak yerine
// mevcut araçları numara alanlarıyla çağırır (search_decisions esas_no/karar_no/chamber,
// get_legislation_article law_no/article_no). Araç seti ve chat.core istemi değişmez (önek sabit kalır).
// Ayrıştırma saf `@eda/legal/kunye` işlevleriyledir; model çıktısı değil kullanıcı metni ayrıştırılır.
import { ChamberCode } from '@eda/contracts/mcp';
import type { CourtType } from '@eda/contracts/tools';
import {
  type CourtClass,
  type DecisionReference,
  parseArticleReferences,
  parseDecisionReferences,
} from '@eda/legal/kunye';

/** Not başına en çok bu kadar atıf yazılır; fazlası kullanıcı metninde zaten görünür. */
const MAX_DECISIONS = 2;
const MAX_ARTICLES = 3;

/** 025 mahkeme sınıfı → araç `court_types` değeri; canlı kapsam dışı sınıflar null (yönlendirme yine yazılır). */
const COURT_TYPE_OF: Readonly<Partial<Record<CourtClass, CourtType>>> = {
  yargitay: 'yargitay',
  danistay: 'danistay',
  istinaf_hukuk: 'istinaf_hukuk',
  yerel: 'ilk_derece_hukuk',
  kyb: 'kyb',
  aym_norm: 'aym_norm',
  uyusmazlik: 'uyusmazlik',
};

const q = (v: string): string => JSON.stringify(v);

function decisionLine(r: DecisionReference): string {
  const nos = [r.esasNo ? `esas ${r.esasNo}` : null, r.kararNo ? `karar ${r.kararNo}` : null]
    .filter((s) => s !== null)
    .join(', ');
  const args = [
    r.esasNo ? `esas_no=${q(r.esasNo)}` : 'esas_no=null',
    r.kararNo ? `karar_no=${q(r.kararNo)}` : 'karar_no=null',
  ];
  const chamber =
    r.chamberCode && ChamberCode.safeParse(r.chamberCode).success ? r.chamberCode : null;
  if (chamber) args.push(`chamber=${q(chamber)}`);
  const courtType = r.courtClass ? COURT_TYPE_OF[r.courtClass] : undefined;
  if (courtType) args.push(`court_types=[${q(courtType)}]`);
  const where = chamber ? ` (${chamber})` : r.courtClass ? '' : ' (mahkeme belirtilmemiş)';
  return `- Karar numarası${where}: ${nos}. Konu araması yapma; search_decisions'ı ${args.join(', ')} ile çağır, query alanına mesajdaki konuyu (yoksa "karar") yaz. Sonuç gelirse metni okunan kararı etiketiyle anlat; gelmezse numaranın ve dairenin doğruluğunu kullanıcıya sor.`;
}

/**
 * Kullanıcı metnindeki doğrudan atıflar için sunucu notu; atıf yoksa null. Çıktı yalnız TUR BAĞLAMI
 * `notices_block` satırına girer; kullanıcıya gösterilmez.
 */
export function referenceHints(userText: string): string | null {
  const lines: string[] = [];
  for (const r of parseDecisionReferences(userText).slice(0, MAX_DECISIONS)) {
    lines.push(decisionLine(r));
  }
  const articles = parseArticleReferences(userText).slice(0, MAX_ARTICLES);
  for (const a of articles) {
    lines.push(
      `- Madde atfı: ${a.lawShort} (${a.lawNo} sayılı) m. ${a.articleNo}. Aramadan doğrudan getir: get_legislation_article'ı law_no=${q(a.lawNo)}, article_no=${q(a.articleNo)} ile çağır; search_legislation çağırma. Yanıtta yalnız bu maddeyi (kenar başlığı, metin, varsa değişiklik notu) ver.`,
    );
  }
  if (lines.length === 0) return null;
  return `Sunucu notu (mesajdaki doğrudan atıflar):\n${lines.join('\n')}`;
}
