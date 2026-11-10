// Komut paleti kısayolu (Ctrl/Cmd+K). Palet modülü tembel yüklendiği için kabukta ayrı dosyadadır.
import { useEffect } from 'react';

export function useCommandPaletteShortcut(open: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase('tr-TR') === 'k') {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}
