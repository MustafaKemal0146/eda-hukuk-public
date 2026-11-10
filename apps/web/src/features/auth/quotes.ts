// Giriş ekranı alıntıları (053-01 §11.3). Yalnız `verified` / `paraphrase` gösterilir; `unverified` asla.
// Türkçe metinler çeviri/serbest aktarımdır (`paraphrase`); hukuk onayı bekliyor: editör kaynakları
// yayın öncesi elle doğrular. Portreler `public/quotes/<id>.webp`; her biri kamu malı veya CC0'dır,
// kaynak ve lisans `portraitCredit` alanındadır (Y-60: hotlink yok).
export type Quote = {
  id: string;
  text: string;
  author: string;
  role: string;
  years: string;
  work: string;
  verification: 'verified' | 'paraphrase' | 'unverified';
  /** `public/quotes/` altındaki kendi portre dosyası; yoksa arayüz monogram gösterir. */
  portrait: string;
  portraitCredit: string;
};

export const QUOTES: readonly Quote[] = [
  {
    id: 'demokritos-adaletsizlik',
    text: 'Adaletsizlik eden, adaletsizliğe uğrayandan daha mutsuzdur.',
    author: 'Demokritos',
    role: 'Antik Yunan düşünürü',
    years: 'M.Ö. 460–370',
    work: 'Diels–Kranz 68 B45',
    verification: 'paraphrase',
    portrait: '/quotes/demokritos-adaletsizlik.webp',
    portraitCredit: 'Wikimedia Commons: Democritus-bust.jpg (CC0)',
  },
  {
    id: 'cicero-salus-populi',
    text: 'Halkın esenliği en yüce kanundur.',
    author: 'Marcus Tullius Cicero',
    role: 'Romalı hukukçu, devlet adamı ve hatip',
    years: 'M.Ö. 106–43',
    work: 'De Legibus III.8',
    verification: 'paraphrase',
    portrait: '/quotes/cicero-salus-populi.webp',
    portraitCredit: 'Wikimedia Commons: M. Tullius Cicero, Capitoline Museum, Rome.jpg (CC0)',
  },
  {
    id: 'aristoteles-adalet',
    text: 'Adalet erdemlerin en yetkinidir; çünkü o, insanın sadece kendine değil, başkalarına karşı da gösterdiği erdemdir.',
    author: 'Aristoteles',
    role: 'Antik Yunan filozofu',
    years: 'M.Ö. 384–322',
    work: "Nikomakhos'a Etik V.1",
    verification: 'paraphrase',
    portrait: '/quotes/aristoteles-adalet.webp',
    portraitCredit: 'Wikimedia Commons: Aristotle Altemps Inv8575.jpg (Public domain)',
  },
  {
    id: 'locke-tiranlik',
    text: 'Kanunların bittiği yerde tiranlık başlar.',
    author: 'John Locke',
    role: 'İngiliz filozof',
    years: '1632–1704',
    work: 'İkinci Hükümet Risalesi §202',
    verification: 'paraphrase',
    portrait: '/quotes/locke-tiranlik.webp',
    portraitCredit:
      'Wikimedia Commons: Godfrey Kneller - Portrait of John Locke (Hermitage).jpg (Public domain)',
  },
  {
    id: 'montesquieu-ozgurluk',
    text: 'Özgürlük, kanunların izin verdiği her şeyi yapabilme hakkıdır.',
    author: 'Montesquieu',
    role: 'Fransız hukukçu ve düşünür',
    years: '1689–1755',
    work: 'Kanunların Ruhu XI.3',
    verification: 'paraphrase',
    portrait: '/quotes/montesquieu-ozgurluk.webp',
    portraitCredit: 'Wikimedia Commons: Montesquieu 1.png (Public domain)',
  },
  {
    id: 'beccaria-kesinlik',
    text: 'Cezanın caydırıcılığı şiddetinden değil, kaçınılmaz olmasından gelir.',
    author: 'Cesare Beccaria',
    role: 'İtalyan hukukçu ve ceza hukuku düşünürü',
    years: '1738–1794',
    work: 'Suçlar ve Cezalar §27',
    verification: 'paraphrase',
    portrait: '/quotes/beccaria-kesinlik.webp',
    portraitCredit: 'Wikimedia Commons: Cesare Beccaria 1738-1794.jpg (Public domain)',
  },
  {
    id: 'kant-adalet',
    text: 'Eğer adalet çökerse, insanların yeryüzünde yaşamasının hiçbir değeri kalmaz.',
    author: 'Immanuel Kant',
    role: 'Alman filozof',
    years: '1724–1804',
    work: 'Ahlak Metafiziği, Hukuk Öğretisi',
    verification: 'paraphrase',
    portrait: '/quotes/kant-adalet.webp',
    portraitCredit:
      'Wikimedia Commons: Immanuel Kant portrait c1790 (3x4 close cropped).jpg (Public domain)',
  },
  {
    id: 'jhering-baris',
    text: 'Hukukun amacı barıştır; barışa ulaşmanın aracı ise mücadeledir.',
    author: 'Rudolf von Jhering',
    role: 'Alman hukukçu',
    years: '1818–1892',
    work: 'Hakkın Mücadelesi',
    verification: 'paraphrase',
    portrait: '/quotes/jhering-baris.webp',
    portraitCredit: 'Wikimedia Commons: RudolfvonIhering2.jpg (Public domain)',
  },
  {
    id: 'hewart-adalet-gorunmeli',
    text: 'Adaletin yalnızca yerine getirilmesi değil, yerine getirildiğinin açıkça görülmesi de gerekir.',
    author: 'Gordon Hewart',
    role: 'İngiliz hâkim, Lord Başyargıç',
    years: '1870–1943',
    work: 'R v Sussex Justices, ex p McCarthy (1924)',
    verification: 'paraphrase',
    portrait: '/quotes/hewart-adalet-gorunmeli.webp',
    portraitCredit: 'Wikimedia Commons: Gordon Hewart LCJ by John Lander.jpg (Public domain)',
  },
];

export const VISIBLE_QUOTES = QUOTES.filter((q) => q.verification !== 'unverified');
