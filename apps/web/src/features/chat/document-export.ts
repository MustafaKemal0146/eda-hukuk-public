// Belge dışa aktarma (PDF): panelde çizilen kâğıdın HTML'i yazdırma iletişim kutusundan PDF'e
// kaydedilir. Bağımlılık yoktur; metin seçilebilir kalır (görüntü değil). Atıf çipleri "(künye)"
// metnine, boşluk işaretleri vurgulu metne dönüşür. DOCX için `studio/docx-writer.ts`.

const TR_MAP: Readonly<Record<string, string>> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

/** Dosya adı: Türkçe harfler ASCII'ye, boşluklar tire; en çok 60 karakter. */
export function fileSlug(title: string): string {
  const folded = [...title.toLocaleLowerCase('tr')].map((c) => TR_MAP[c] ?? c).join('');
  const slug = folded
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug === '' ? 'belge' : slug;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
@page { size: A4; margin: 20mm 20mm 20mm 25mm; }
body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.5; color: black; }
p { margin: 0 0 6pt; text-align: justify; text-indent: 1.25cm; }
h3, h4, h5 { font-size: 12pt; font-weight: bold; margin: 10pt 0 4pt; }
.baslik { text-align: center; text-indent: 0; }
ul, ol { margin: 0 0 6pt; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 0.5pt solid black; padding: 2pt 4pt; vertical-align: top; text-align: left; }
mark { background: yellow; color: black; }
`;

/** Çıktı belgesi: Word'ün HTML'i sayfa olarak açması için `xmlns` ve `charset` bildirilir.
 * `extraCss` (stüdyo sayfa düzeni: yazı tipi/punto/aralık) varsayılan stilin ardına eklenir. */
export function buildExportHtml(title: string, bodyHtml: string, extraCss = ''): string {
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="tr">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}${extraCss}</style></head>
<body>${bodyHtml}</body>
</html>`;
}

/** Kâğıt düğümünün çıktı HTML'i: düğmeler ve simgeler atılır, çipler metin olur. */
export function paperHtml(paper: HTMLElement): string {
  const clone = paper.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('svg, script, style, img, iframe, object, embed, link')) {
    el.remove();
  }
  for (const el of clone.querySelectorAll('a[href]')) el.removeAttribute('href');
  for (const el of clone.querySelectorAll('button')) {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    el.replaceWith(clone.ownerDocument.createTextNode(text === '' ? '' : `(${text})`));
  }
  for (const el of clone.querySelectorAll('.sr-only')) el.remove();
  for (const el of clone.querySelectorAll('[class]')) {
    el.removeAttribute('class');
    el.removeAttribute('style');
  }
  return clone.innerHTML;
}

/** Gizli çerçevede yazdırma iletişim kutusunu açar; "PDF olarak kaydet" seçilir. */
export function printPdf(title: string, bodyHtml: string, extraCss = ''): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  // Script çalıştırmayan ama yazdırma iletişim kutusunu açabilen ve aynı origin'den yazılabilen çerçeve.
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  document.body.append(frame);
  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    return;
  }
  win.document.open();
  win.document.write(buildExportHtml(title, bodyHtml, extraCss));
  win.document.close();
  const cleanup = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener('afterprint', cleanup);
  setTimeout(() => {
    win.focus();
    win.print();
  }, 50);
}
