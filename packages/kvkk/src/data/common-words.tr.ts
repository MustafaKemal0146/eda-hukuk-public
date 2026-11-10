// Ad/soyad olarak da kullanılan yaygın sözcükler (026 §6.4, §7.4). Hukuk onayı bekliyor.
// Durdurma listesi DEĞİLDİR: yalnız tek sözcüklü sözlük/öğrenilen varyantlara `weak` etiketi ekler
// (ölçüm: weak_match_rate). Elle derlenmiş başlangıç listesi.

const RAW = `
ada ahu akın ak altın arslan aslan ateş ay aydın bahar barış bilge bulut can cem cennet çelik çınar çiçek
demir deniz devrim doğan doruk ece elmas er fidan gül güneş güney hayal hasret ırmak ışık inci ipek kader
kar kara kardelen kartal kaya kiraz kumsal kurt kuzey lale menekşe mercan mert nehir nergis nimet nur
ozan öz özgür pınar polat sedef servet sevgi sevinç sönmez şahin şimşek şükran tekin toprak tuna umut
ümit yağmur yalçın yaprak yıldız yılmaz yiğit zafer savaş bayram dursun durmuş kılıç tunç tufan
akar aksoy aktaş arı balcı başaran bozkurt çakır çoban dağ dal duman erdem ergin güven kalkan kandemir
karaca keskin koç korkmaz öztürk sarı soylu şen tan tok tuncer turan uçar uysal yalın yavuz yazıcı yücel
`;

export const COMMON_WORDS: readonly string[] = [
  ...new Set(RAW.split(/\s{1,8}/u).filter((w) => w.length > 0)),
].sort();
