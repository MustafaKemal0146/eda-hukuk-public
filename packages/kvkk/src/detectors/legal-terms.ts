// LEGAL_TERMS koruma kümesi (026 §6.5). Hukuk onayı bekliyor (genişletme kısmı).
// Tek dosyadır; packages/legal/src/text/legal-terms.ts (023, hevesli getirim) farklı amaçlı ayrı listedir
// ve birleştirilmez. Karşılaştırma foldChars + ek-soyulmuş kökle yapılır (toLocaleLowerCase yok).
import { foldChars } from '../fold.ts';
import { generateTails } from '../suffix/tails.ts';

/** Çekirdek: eski plan 016/082 listesi, 44 sözcük, AYNEN. */
export const LEGAL_TERMS_CORE: readonly string[] = [
  'kanunu',
  'kanun',
  'kanunda',
  'kanununa',
  'kanunun',
  'mahkemesi',
  'mahkemesine',
  'mahkeme',
  'dairesi',
  'dairesine',
  'daire',
  'yargıtay',
  'danıştay',
  'asliye',
  'sulh',
  'icra',
  'idare',
  'hukuk',
  'ceza',
  'ticaret',
  'aile',
  'kadastro',
  'vergi',
  'sigorta',
  'bölge',
  'adliye',
  'anayasa',
  'anayasası',
  'maddesi',
  'hükmü',
  'hüküm',
  'kararı',
  'karar',
  'uyuşmazlık',
  'yüksek',
  'seçim',
  'tüketici',
  'kamu',
  'mevzuat',
  'cumhuriyet',
  'başsavcılığı',
  'genel',
  'işçi',
  'sendika',
];

/** Ay ve gün adları (026 §6.5 genişletme; cümle başı büyük harf yanlış pozitifini önler). */
export const CALENDAR_TERMS: readonly string[] = [
  'ocak',
  'şubat',
  'mart',
  'nisan',
  'mayıs',
  'haziran',
  'temmuz',
  'ağustos',
  'eylül',
  'ekim',
  'kasım',
  'aralık',
  'pazartesi',
  'salı',
  'çarşamba',
  'perşembe',
  'cuma',
  'cumartesi',
  'pazar',
];

/** Genişletme (026 §6.5 başlangıç listesi; hukuk onayı bekliyor); ay/gün adları ayrıca eklenir. */
export const LEGAL_TERMS_EXTENSION: readonly string[] = [
  'kurulu',
  'kurul',
  'başkanlığı',
  'başkanı',
  'başsavcılığı',
  'savcılığı',
  'müdürlüğü',
  'bakanlığı',
  'bakanlar',
  'komisyonu',
  'meclisi',
  'büyük',
  'millet',
  'türk',
  'türkiye',
  'borçlar',
  'medeni',
  'usul',
  'muhakemeleri',
  'iflas',
  'idari',
  'yargılama',
  'usulü',
  'ceza',
  'muhakemesi',
  'genel kurul',
  'hukuk dairesi',
  'ceza dairesi',
  'ihale',
  'rekabet',
  'kurumu',
  'davacı',
  'davalı',
  'vekili',
  'müvekkil',
  'sanık',
  'şüpheli',
  'konu',
  'açıklamalar',
  'sonuç',
  'talep',
  'ek',
  'ekler',
  'sayın',
  'bay',
  'bayan',
  ...CALENDAR_TERMS,
];

/** foldChars biçimi -> özgün yazım (ek üretimi özgün ünlülerle yapılır). */
const ORIGINAL = new Map<string, string>(
  [...LEGAL_TERMS_CORE, ...LEGAL_TERMS_EXTENSION].map((t) => [foldChars(t), t] as const),
);

/** foldChars biçiminde birleşik küme. */
export const LEGAL_TERMS: ReadonlySet<string> = new Set(ORIGINAL.keys());
const CALENDAR = new Set(CALENDAR_TERMS.map((t) => foldChars(t)));

const memo = new Map<string, string | null>();
const STEM_MIN = 4;

/** Sözcüğün LEGAL_TERMS'teki kökü (tam veya ek-soyulmuş); yoksa null. */
function legalStem(f: string): string | null {
  if (LEGAL_TERMS.has(f)) return f;
  // Ek-soyulmuş kök en az 4 harf: kısa kökler (ek, bay) ad yanlış eşleşmesi üretir (Ekin, Baya).
  for (let cut = f.length - 1; cut >= STEM_MIN && f.length - cut <= 8; cut -= 1) {
    const stem = f.slice(0, cut);
    const original = ORIGINAL.get(stem);
    if (original === undefined) continue;
    const tail = f.slice(cut);
    for (const t of generateTails(original)) {
      if (foldChars(t) === tail) return stem;
    }
  }
  return null;
}

/**
 * Sözcük (veya ek-soyulmuş kökü) LEGAL_TERMS'te mi: "Mahkemeye" -> "mahkeme" + "ye". Kesmeli ek
 * önceden ayrılmış olmalıdır; burada yalnız kesmesiz ek denenir. `calendar: false` ay/gün adlarını
 * saymaz: ad dizisinin sağ kırpmasında soyad olarak kullanılan gün adı ("Yurdagül Perşembe", 026 §6.7
 * örneği) korunur.
 */
export function isLegalTermWord(word: string, opts: { calendar?: boolean } = {}): boolean {
  const f = foldChars(word).replace(/[.:,;]{1,4}$/u, '');
  if (f.length === 0) return false;
  let stem = memo.get(f);
  if (stem === undefined) {
    stem = legalStem(f);
    if (memo.size > 8192) memo.clear();
    memo.set(f, stem);
  }
  if (stem === null) return false;
  return opts.calendar === false ? !CALENDAR.has(stem) : true;
}
