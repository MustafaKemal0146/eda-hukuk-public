// Kişi adı olarak algılanmaması gereken hukuki/kurumsal kısaltmalar (026 §6.4 durdurma).
// Hukuk onayı bekliyor. Elle derlenmiş başlangıç listesi; BÜYÜK harfli sözcük dizisinde adayı keser.

const RAW = `
AİHM AİHS AYM BAM BK CGK CMK DAİRE DMK GİB HD HGK HMK HSK İBK İDDK İİK İYUK KDV KHK MK ÖTV SGK SPK TBK
TBMM TC TCK TL TMK TTK TÜİK VUK YCGK YHGK YİBK ŞTİ AŞ LTD KVKK UYAP MERSİS BDDK EPDK RTÜK TMSF YSK
`;

export const ACRONYMS: readonly string[] = [
  ...new Set(RAW.split(/\s{1,8}/u).filter((w) => w.length > 0)),
].sort();
