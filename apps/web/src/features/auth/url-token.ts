// Bağlantıdaki tek kullanımlık belirteç `#token=` (veya eski `?token=`) ile gelir; okunur okunmaz
// adres çubuğundan silinir (referrer/geçmiş sızıntısı yok; 053-01 §6, §7).
export function takeUrlToken(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const token = hash.get('token') ?? query.get('token');
  if (token !== null) {
    query.delete('token');
    const qs = query.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }
  return token && token.length <= 4096 ? token : null;
}
