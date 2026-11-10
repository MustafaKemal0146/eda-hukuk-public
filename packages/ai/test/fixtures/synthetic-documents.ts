// Dosyayla sohbet sentetik belgeleri (P21 ilk dilimi). Taraflar, mahkeme ve tutarlar
// UYDURMADIR; gerçek kişi, künye veya dosya numarası yoktur. Aynı içerik yerel uçtan uca denemede PDF ve
// DOCX'e dönüştürülür (sayfa = satır listesi). Her belge için üç soru ve yanıtın bağlamda geçmesi
// gereken ifade (`answer`) tanımlıdır.

export interface QaCase {
  readonly question: string;
  readonly answer: string;
}

export interface SyntheticDocument {
  readonly key: 'kira' | 'dilekce' | 'karar';
  readonly fileType: 'pdf' | 'docx';
  /** Sayfa başına satırlar (DOCX'te tek sayfa = paragraflar). */
  readonly pages: readonly (readonly string[])[];
  readonly qa: readonly QaCase[];
}

export const KIRA: SyntheticDocument = {
  key: 'kira',
  fileType: 'pdf',
  pages: [
    [
      'ÖRNEK İŞYERİ KİRA SÖZLEŞMESİ',
      'Kiraya veren: Örnek Gayrimenkul Yatırım A.Ş.',
      'Kiracı: Deneme Danışmanlık Ltd. Şti.',
      'Kiralanan: Örnek Mahallesi Deneme Caddesi No: 1 iç kapı 4, büro olarak kullanılacaktır.',
      'Madde 1 - Konu: Kiralananın büro olarak kullanılması amacıyla kiraya verilmesidir.',
      'Madde 2 - Kira bedeli: Aylık kira bedeli 27.500 TL olup her ayın beşinci gününe kadar',
      'kiraya verenin banka hesabına peşin olarak ödenir.',
      'Madde 3 - Süre: Sözleşmenin süresi 2 (iki) yıldır ve 01.01.2026 tarihinde başlar.',
      'Madde 4 - Depozito: Kiracı sözleşme imzasında iki aylık tutarı güvence olarak öder.',
      'Madde 5 - Artış: Yenilenen dönemde artış yasal sınırları aşamaz.',
    ],
    [
      'Madde 6 - Kullanım: Kiracı kiralananı özenle kullanır, komşulara saygı gösterir.',
      'Madde 7 - Fesih: Taraflardan her biri sözleşmeyi en az üç ay önceden yazılı bildirimle',
      'feshedebilir. Bildirim noter aracılığıyla veya iadeli taahhütlü mektupla yapılır.',
      'Madde 8 - Tahliye: Sözleşme sona erdiğinde kiralanan boş ve hasarsız teslim edilir.',
      'Madde 9 - Uyuşmazlık: Uyuşmazlıklarda kiralananın bulunduğu yer mahkemeleri yetkilidir.',
      'İşbu sözleşme iki nüsha olarak düzenlenmiş ve taraflarca okunarak imzalanmıştır.',
      'Kiraya veren                                   Kiracı',
    ],
  ],
  qa: [
    { question: 'Aylık kira bedeli ne kadar?', answer: '27.500 TL' },
    { question: 'Sözleşmenin süresi ne kadar?', answer: '2 (iki) yıl' },
    { question: 'Fesih için ne kadar önceden bildirim gerekiyor?', answer: 'üç ay önceden' },
  ],
};

export const DILEKCE: SyntheticDocument = {
  key: 'dilekce',
  fileType: 'docx',
  pages: [
    [
      "İSTANBUL ( ) ASLİYE TİCARET MAHKEMESİ'NE",
      'DAVACI: Deneme Yazılım Hizmetleri Ltd. Şti.',
      'VEKİLİ: Av. Örnek Avukat',
      'DAVALI: Örnek Lojistik A.Ş.',
      'KONU: Ödenmeyen yazılım hizmet bedelinin tahsili talebidir.',
      'DAVA DEĞERİ: 85.000 TL',
      'AÇIKLAMALAR:',
      '1. Müvekkil şirket ile davalı arasında yazılım bakım hizmeti için sözleşme kurulmuştur.',
      '2. Müvekkil edimini eksiksiz ifa etmiş, düzenlenen faturalar davalıya tebliğ edilmiştir.',
      '3. Davalı, ihtara rağmen 85.000 TL tutarındaki hizmet bedelini ödememiştir.',
      'HUKUKİ NEDENLER: TBK, TTK, HMK ve ilgili mevzuat.',
      'DELİLLER: Sözleşme, faturalar, ihtarname, ticari defterler ve her türlü yasal delil.',
      'TALEP SONUCU: Fazlaya ilişkin haklarımız saklı kalmak kaydıyla 85.000 TL alacağın temerrüt',
      'tarihinden itibaren işleyecek ticari faiziyle birlikte davalıdan tahsiline, yargılama',
      'giderleri ile vekâlet ücretinin davalıya yükletilmesine karar verilmesini saygıyla arz ederiz.',
      'Davacı Vekili',
    ],
  ],
  qa: [
    {
      question: 'Dilekçe hangi mahkemeye hitaben yazılmış?',
      answer: 'ASLİYE TİCARET MAHKEMESİ',
    },
    { question: 'Dava değeri ne kadar?', answer: '85.000 TL' },
    {
      question: 'Talep sonucunda ne isteniyor?',
      answer: 'ticari faiziyle birlikte davalıdan tahsiline',
    },
  ],
};

const FILLER = [
  'Dosya kapsamındaki deliller birlikte değerlendirilmiş ve tutanaklar incelenmiştir.',
  'Tarafların duruşmadaki beyanları ayrı ayrı tutanağa geçirilmiştir.',
  'Tanık anlatımlarının olayın oluş biçimi yönünden birbirini doğruladığı görülmüştür.',
  'Taraf vekillerinin süresi içinde sunduğu dilekçeler dosyaya eklenmiştir.',
  'Mahkemece taraflara delillerini bildirmeleri için kesin süre verilmiştir.',
  'Davalı vekili cevap dilekçesinde davanın esastan reddini istemiştir.',
  'Davacı vekili sunduğu beyan dilekçesinde önceki açıklamalarını tekrar etmiştir.',
  'Uyuşmazlığın çözümü için dosyadaki yazışmaların içeriği önem taşımaktadır.',
  'Ticari defterlerin açılış ve kapanış onaylarının usulüne uygun olduğu anlaşılmıştır.',
  'Taraflar arasındaki ilişkinin sürekli nitelikte olduğu kabul edilmektedir.',
  'Mahkemece ön inceleme duruşmasında sulh olanağı taraflara hatırlatılmıştır.',
  'Dosyanın tensip zaptıyla birlikte taraflara tebligat çıkarılmıştır.',
];

function fillerPage(page: number): string[] {
  const lines: string[] = [`ÖRNEK BÖLGE MAHKEMESİ KARARI - SAYFA ${page}`];
  for (let i = 0; i < 42; i += 1) {
    lines.push(FILLER[(page * 7 + i * 5) % FILLER.length] ?? '');
  }
  return lines;
}

function kararPages(): string[][] {
  const pages: string[][] = [];
  for (let p = 1; p <= 30; p += 1) pages.push(fillerPage(p));
  pages[0] = [
    'T.C. ÖRNEK BÖLGE ADLİYE MAHKEMESİ 99. HUKUK DAİRESİ',
    'KARAR METNİ (SENTETİK DENEME BELGESİDİR, GERÇEK DOSYA DEĞİLDİR)',
    'DAVACI: Deneme Nakliyat A.Ş.    DAVALI: Örnek Sigorta A.Ş.',
    'DAVA: Taşıma sırasında oluşan zararın tazmini',
    ...fillerPage(1).slice(1, 38),
  ];
  pages[16] = [
    ...fillerPage(17).slice(0, 20),
    'Mahkemece görevlendirilen bilirkişi heyetinin raporunda araçtaki hasar bedeli 184.250 TL olarak',
    'belirlenmiş, rapora karşı yapılan itirazlar ek raporla karşılanmıştır.',
    ...fillerPage(17).slice(20, 40),
  ];
  pages[22] = [
    ...fillerPage(23).slice(0, 25),
    'Faizin başlangıcı yönünden davalının temerrüde düştüğü 14.03.2024 tarihinden itibaren',
    'avans faizi işletilmesi gerektiği sonucuna varılmıştır.',
    ...fillerPage(23).slice(25, 40),
  ];
  pages[29] = [
    ...fillerPage(30).slice(0, 30),
    'HÜKÜM: Yukarıda açıklanan nedenlerle davanın KISMEN KABULÜNE,',
    "Yargılama giderleri olan 3.120,40 TL'nin davalıya yüklenmesine,",
    'karar verildi.',
  ];
  return pages;
}

export const KARAR: SyntheticDocument = {
  key: 'karar',
  fileType: 'pdf',
  pages: kararPages(),
  qa: [
    { question: 'Bilirkişi raporunda belirlenen hasar bedeli ne kadar?', answer: '184.250 TL' },
    { question: 'Faiz hangi tarihten itibaren işletilecek?', answer: '14.03.2024' },
    { question: 'Yargılama giderleri kime yüklendi?', answer: '3.120,40' },
  ],
};

export const SYNTHETIC_DOCUMENTS = [KIRA, DILEKCE, KARAR] as const;

/** Çıkarıcının ürettiği biçim: sayfa içi satırlar `\n`, sayfalar `\n\n`. */
export function textOf(doc: SyntheticDocument): { text: string; pageOffsets: number[] } {
  const pageOffsets: number[] = [];
  let text = '';
  doc.pages.forEach((lines, i) => {
    if (i > 0) text += '\n\n';
    pageOffsets.push(text.length);
    text += lines.join('\n');
  });
  return { text, pageOffsets: doc.fileType === 'pdf' ? pageOffsets : [] };
}
