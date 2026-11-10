// Karar bölüm metni (053-04 §5.3): kaynak Markdown'ı HTML'e çevrilmeden React düğümlerine dönüşür.
// Yalnız paragraf ve `**kalın**` tanınır; başlık işaretleri atılır, geri kalan her şey düz metindir
// (ham HTML, bağlantı, görsel yok; React dışı HTML enjeksiyonu yok).
import type { ReactNode } from 'react';

export function paragraphsOf(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/\\([\\`*_{}[\]()#+\-.!>|])/g, '$1'))
        .join('\n')
        .trim(),
    )
    .filter((p) => p !== '');
}

/** `**kalın**` aralıkları → `<strong>`; eşleşmeyen yıldızlar düz metin kalır. */
export function inlineNodes(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const rx = /\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(rx)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <strong key={m.index} className="font-semibold">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function SectionText({ markdown, idPrefix }: { markdown: string; idPrefix: string }) {
  return (
    <div lang="tr" className="flex max-w-prose flex-col gap-3 text-body text-fg">
      {paragraphsOf(markdown).map((p, i) => (
        <p key={`${idPrefix}-${i}`} id={`${idPrefix}-p${i + 1}`} className="whitespace-pre-line">
          {inlineNodes(p)}
        </p>
      ))}
    </div>
  );
}
