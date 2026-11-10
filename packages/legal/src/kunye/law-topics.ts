// Konu → kanun ipucu (#12): mevzuat araması kanun filtresi olmadan madde içeriğinde değil kanun
// adında arar ("yaya geçidi" 0 sonuç, `law_no = 2918` ile m. 68/74 gelir). Boş sonuçta sorgudaki konu
// sözcüklerinden en olası kanunlar çıkarılır ve arama o kanun içinde yinelenir. YALNIZ yönlendirme
// ipucudur, hukuki sınıflandırma değildir; sonuç kullanıcıya "tahmini eşleme" notuyla verilir.
// Liste hukuk onayı bekler.
import { tr_fold } from '../text/index.ts';

type Topic = { lawNo: string; stems: readonly string[] };

/** `stems`: tr_fold'lu sözcük kökleri; sözcük başı eşleşir ("yaya" → yayalar, yayaya). */
const TOPICS: readonly Topic[] = [
  {
    lawNo: '2918',
    stems: [
      'yaya',
      'trafik',
      'surucu',
      'ehliyet',
      'kirmizi isik',
      'hiz siniri',
      'alkollu arac',
      'motosiklet',
      'plaka',
      'trafik kaza',
    ],
  },
  {
    lawNo: '6098',
    stems: [
      'kira',
      'kiraci',
      'tahliye',
      'haksiz fiil',
      'kefalet',
      'cezai sart',
      'temerrut',
      'sebepsiz zenginlesme',
      'satis sozlesme',
      'eser sozlesme',
      'ayip',
    ],
  },
  {
    lawNo: '4857',
    stems: [
      'is sozlesme',
      'isci',
      'isveren',
      'fazla mesai',
      'yillik izin',
      'is guvencesi',
      'ise iade',
      'fesih bildirim',
    ],
  },
  {
    lawNo: '5237',
    stems: [
      'cinsel saldiri',
      'tecavuz',
      'hirsizlik',
      'dolandiricilik',
      'yaralama',
      'kasten oldurme',
      'hakaret',
      'tehdit',
      'santaj',
      'uyusturucu',
      'zimmet',
      'guveni kotuye',
    ],
  },
  {
    lawNo: '5271',
    stems: ['tutuklama', 'gozalti', 'iddianame', 'kovusturma', 'adli kontrol', 'sorusturma'],
  },
  {
    lawNo: '6100',
    stems: [
      'dava sarti',
      'ihtiyati tedbir',
      'bilirkisi',
      'delil tespit',
      'gorevli mahkeme',
      'yetkili mahkeme',
    ],
  },
  {
    lawNo: '4721',
    stems: ['miras', 'vasiyet', 'bosanma', 'velayet', 'nafaka', 'evlilik', 'mal rejimi', 'tapu'],
  },
  { lawNo: '2004', stems: ['icra', 'haciz', 'iflas', 'konkordato', 'odeme emri', 'ilamsiz takip'] },
  {
    lawNo: '6102',
    stems: ['anonim sirket', 'limited sirket', 'ticari defter', 'bono', 'ticari isletme'],
  },
  { lawNo: '6698', stems: ['kisisel veri', 'veri sorumlusu', 'kvkk'] },
  {
    lawNo: '2577',
    stems: [
      'idari dava',
      'iptal davasi',
      'yurutmenin durdurulmasi',
      'tam yargi',
      'idare mahkemesi',
    ],
  },
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Sorgudaki konu sözcüklerine göre en olası kanun numaraları (çok eşleşenden aza, en çok `max`).
 * Eşleşme yoksa boş dizi. Kanun numarası verilmiş aramalarda çağrılmaz.
 */
export function inferLawNosFromQuery(query: string, max = 2): string[] {
  const folded = ` ${tr_fold(query)} `;
  const scored = TOPICS.map((t) => ({
    lawNo: t.lawNo,
    score: t.stems.filter((s) => new RegExp(`[^a-z0-9]${escapeRe(s)}`).test(folded)).length,
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((x) => x.lawNo);
}
