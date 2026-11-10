// Küçük XML ayrıştırıcı: UDF ve DOCX paketlerindeki bellek-içi XML için yeterli alt küme (öğe, öznitelik,
// metin, CDATA, yorum, işleme yönergesi, dört ön tanımlı ve sayısal karakter varlığı). DTD ve dış
// varlık YOK (varlık genişletme saldırısı yüzeyi yok); `<!DOCTYPE` görülürse reddedilir. Ad alanı
// çözümlenmez: `w:p` için `local` = `p`, `name` = `w:p`. Tarayıcıdan ve testten aynı çalışır.

export type XmlNode = {
  name: string;
  local: string;
  attrs: Readonly<Record<string, string>>;
  children: XmlNode[];
  /** Doğrudan alt metin ve CDATA birleşimi (alt öğelerin metni dahil değil). */
  text: string;
};

export class XmlError extends Error {}

const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;

function decode(s: string): string {
  return s.replace(ENTITY, (_, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.startsWith('#x')
      ? Number.parseInt(e.slice(2), 16)
      : Number.parseInt(e.slice(1), 10);
    try {
      return String.fromCodePoint(code);
    } catch {
      return '';
    }
  });
}

const MAX_DEPTH = 200;

export function parseXml(src: string): XmlNode {
  let i = 0;
  const root: XmlNode = { name: '#root', local: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1] as XmlNode;
    if (lt === -1) {
      top.text += decode(src.slice(i));
      break;
    }
    if (lt > i) top.text += decode(src.slice(i, lt));
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      if (end === -1) throw new XmlError('cdata');
      top.text += src.slice(lt + 9, end);
      i = end + 3;
    } else if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      if (end === -1) throw new XmlError('comment');
      i = end + 3;
    } else if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt);
      if (end === -1) throw new XmlError('pi');
      i = end + 2;
    } else if (src.startsWith('<!', lt)) {
      throw new XmlError('doctype');
    } else if (src.startsWith('</', lt)) {
      const end = src.indexOf('>', lt);
      if (end === -1) throw new XmlError('close');
      const name = src.slice(lt + 2, end).trim();
      if (stack.length < 2 || (stack[stack.length - 1] as XmlNode).name !== name) {
        throw new XmlError('mismatch');
      }
      stack.pop();
      i = end + 1;
    } else {
      // Açılış etiketi: öznitelik değerinde `>` bulunabilir; tırnak içi atlanır.
      let j = lt + 1;
      let quote = '';
      while (j < n) {
        const c = src[j] as string;
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j += 1;
      }
      if (j >= n) throw new XmlError('open');
      let inner = src.slice(lt + 1, j);
      const selfClose = inner.endsWith('/');
      if (selfClose) inner = inner.slice(0, -1);
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(inner);
      if (!m) throw new XmlError('tag');
      const name = m[1] as string;
      const attrs: Record<string, string> = {};
      for (const a of (m[2] as string).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attrs[a[1] as string] = decode((a[2] ?? a[3]) as string);
      }
      const node: XmlNode = {
        name,
        local: name.includes(':') ? name.slice(name.indexOf(':') + 1) : name,
        attrs,
        children: [],
        text: '',
      };
      top.children.push(node);
      if (!selfClose) {
        if (stack.length > MAX_DEPTH) throw new XmlError('depth');
        stack.push(node);
      }
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new XmlError('unclosed');
  const el = root.children[0];
  if (!el || root.children.length !== 1) throw new XmlError('root');
  return el;
}
