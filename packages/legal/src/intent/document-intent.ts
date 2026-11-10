// Belge niyeti (022 §9.1 tamamlayıcısı): kullanıcı mesajından "belge yaz" / "belge yazma" / belirtilmedi
// kararı. Deterministik kural; ayrı model çağrısı yoktur (022 §9.4 tek istek kuralı). Çıktı sunucu
// kapısıdır: model `create_document` aracını yalnız niyet açıkken yürütebilir. Türkçe eklerden
// bağımsız olmak için metin `tr_fold` ile ASCII'ye katlanır. Muhafazakâr: kuşkuda `neutral`.
import { tr_fold } from '../text/index.ts';

export type DocumentIntent = 'draft' | 'forbid' | 'neutral';
export type DocumentKind = 'petition' | 'notice' | 'contract' | 'opinion' | 'other';

export type DocumentIntentResult = {
  intent: DocumentIntent;
  /** Belge türü ipucu (yalnız intent = draft iken anlamlı); belirsizse null. */
  kind: DocumentKind | null;
};

const KIND_PATTERNS: readonly [DocumentKind, RegExp][] = [
  ['notice', /\b(ihtarname|ihtar|ihbarname)\w*/],
  ['contract', /\b(sozlesme|protokol|vekaletname|feragatname|ibraname|taahhutname)\w*/],
  ['opinion', /\b(mutalaa|gorus yazisi|hukuki gorus)\w*/],
  [
    'petition',
    /\b(dilekce|cevap dilekcesi|itiraz|layiha|temyiz|istinaf|sikayet|talep|savunma|cevap)\w*/,
  ],
];
/** Belge adı; "belge" ve "taslak" genel adlardır. */
const NOUN =
  /\b(dilekce|ihtarname|ihtar|ihbarname|sozlesme|protokol|vekaletname|feragatname|ibraname|taahhutname|mutalaa|layiha|belge|evrak|taslak|metin)\w*/;
/** Üretme fiilleri (kök); `\b` sonu sayesinde "yazma/yazim" gibi başka biçimler eşleşmez. */
const DRAFT_VERB =
  /\b(yaz|yazin|yazar misin|yazabilir misin|yazabilir misiniz|yazalim|hazirla|hazirlar misin|hazirlayin|hazirlayabilir\w*|olustur|olusturun|olusturabilir\w*|kaleme al|cikar|cikarir misin|duzenle|duzenler misin|uret|ver)\b/;
/** Yalnız soru olmayan cümlede istek sayılan zayıf kalıp: "bana bir dilekçe lazım". */
const WEAK_NEED = /\b(lazim|gerek|gerekiyor|istiyorum|isterim|ihtiyacim var|ihtiyac var)\b/;
/** Belge yazmama isteği. */
const NEGATION =
  /\b(yazma|yazmayin|yazmayiniz|yazmana gerek|yazmak istemiyorum|yazmayalim|yazmani istemiyorum|hazirlama|hazirlamayin|olusturma|olusturmayin|duzenleme|duzenlemeyin|cikarma|acma|acmayin)\b|\b(istemiyorum|istemem|gerekmiyor|gerek yok|lazim degil|gerekli degil|ihtiyac yok|degil)\b/;
/** Belge dışı yanıt isteği: "sadece görüş", "yalnız bilgi ver". */
const CHAT_ONLY =
  /\b(sadece|yalnizca|yalniz|sadece bir)\s+(gorus|bilgi|aciklama|degerlendirme|yorum|ozet)\b|\bbelge\s+(degil|olmadan|olmasin|istemiyorum)\b|\bsohbet\s+(olarak|halinde)\b/;
const QUESTION = /\?|\b(mi|mu|mı|mü)\s*$/;

function clauses(folded: string): string[] {
  return folded
    .split(/[.!?;\n]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function kindOf(text: string): DocumentKind | null {
  for (const [kind, re] of KIND_PATTERNS) if (re.test(text)) return kind;
  return /\b(belge|taslak|evrak)\w*/.test(text) ? 'other' : null;
}

export function detectDocumentIntent(userText: string): DocumentIntentResult {
  const folded = tr_fold(userText);
  const parts = clauses(folded);
  // 1) Açık yasak her şeyden önce gelir ("belge yazma", "sadece görüş ver").
  if (CHAT_ONLY.test(folded)) return { intent: 'forbid', kind: null };
  for (const c of parts) {
    if (NOUN.test(c) && NEGATION.test(c) && !DRAFT_AFTER_NEGATION_EXCEPTION.test(c)) {
      return { intent: 'forbid', kind: null };
    }
  }
  // 2) Açık istek: belge adı + üretme fiili (veya "bana bir X lazım").
  for (const c of parts) {
    if (!NOUN.test(c)) continue;
    const asked = DRAFT_VERB.test(c);
    const needed = WEAK_NEED.test(c) && !QUESTION.test(c);
    if (asked || needed) return { intent: 'draft', kind: kindOf(c) };
  }
  return { intent: 'neutral', kind: null };
}

/** "değil" yalnız belge adıyla birlikte yasak sayılır; "emin değilim" gibi cümleleri yutmaz. */
const DRAFT_AFTER_NEGATION_EXCEPTION = /\b(emin|kesin|net|uygun)\s+degil/;
