// 81 il adı ve yaygın kısa biçimleri (ADRES "İlçe/İl" çifti ve KISI konum durdurması; 026 §6.3, §6.4).
// Hukuk onayı bekliyor. Kamuya açık idari bölüm adlarıdır; kişisel veri değildir.

const RAW = `
Adana Adıyaman Afyonkarahisar Afyon Ağrı Aksaray Amasya Ankara Antalya Ardahan Artvin Aydın Balıkesir
Bartın Batman Bayburt Bilecik Bingöl Bitlis Bolu Burdur Bursa Çanakkale Çankırı Çorum Denizli Diyarbakır
Düzce Edirne Elazığ Erzincan Erzurum Eskişehir Gaziantep Antep Giresun Gümüşhane Hakkari Hatay Iğdır
Isparta İstanbul İzmir Kahramanmaraş Maraş Karabük Karaman Kars Kastamonu Kayseri Kilis Kırıkkale
Kırklareli Kırşehir Kocaeli Konya Kütahya Malatya Manisa Mardin Mersin Muğla Muş Nevşehir Niğde Ordu
Osmaniye Rize Sakarya Samsun Siirt Sinop Sivas Şanlıurfa Urfa Şırnak Tekirdağ Tokat Trabzon Tunceli
Uşak Van Yalova Yozgat Zonguldak
`;

export const PROVINCES: readonly string[] = [
  ...new Set(RAW.split(/\s{1,8}/u).filter((w) => w.length > 0)),
].sort();
