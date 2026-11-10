// Bloklardan çıktı HTML'i (PDF yazdırma): paragraf, başlık, liste. Metin her zaman kaçışlanır.
import type { Block, Run } from '../studio/doc-convert.ts';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function runHtml(r: Run): string {
  let h = esc(r.text).replace(/\t/g, '&emsp;').replace(/\n/g, '<br>');
  if (r.marks.includes('underline')) h = `<u>${h}</u>`;
  if (r.marks.includes('italic')) h = `<em>${h}</em>`;
  if (r.marks.includes('bold')) h = `<strong>${h}</strong>`;
  return h;
}

export function blocksToHtml(blocks: readonly Block[]): string {
  const out: string[] = [];
  let list: 'ol' | 'ul' | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const b of blocks) {
    if (b.kind === 'li') {
      const tag = b.ordered ? 'ol' : 'ul';
      if (list !== tag) {
        close();
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${b.runs.map(runHtml).join('')}</li>`);
      continue;
    }
    close();
    const inner = b.runs.map(runHtml).join('') || '&nbsp;';
    if (b.kind === 'h') out.push(`<h3>${inner}</h3>`);
    else {
      const style =
        b.align === 'center' || b.align === 'right'
          ? ` style="text-align:${b.align};text-indent:0"`
          : b.align === 'left'
            ? ' style="text-align:left;text-indent:0"'
            : '';
      out.push(`<p${style}>${inner}</p>`);
    }
  }
  close();
  return out.join('');
}
