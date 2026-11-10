// İşleyici sonucu: modele giden metin + isteğe bağlı bildirim ve pipeline ayrıntısı (sunucu üretir).
export type ToolOutcome = {
  text: string;
  isError: boolean;
  notice?: 'source_unavailable' | 'source_busy';
  detail?: string;
  /** Çağrı bütçeden düşülmeyecek: araç iş yapmadan yalnız "hak doldu" notu döndü (#12). */
  refundCall?: boolean;
};
