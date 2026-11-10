// Bağlantı işareti (054 §2.3): yalnız `https:` ve `mailto:`; otomatik bağlantı, tıklayınca açma ve
// yapıştırmada bağlantı YOK; `target` saklanmaz, `rel="noopener noreferrer"`. StarterKit `link`
// kapatılır ve yalnız `href` özniteliği taşıyan bu işaret kullanılır.
import { Mark } from '@tiptap/core';

export const LINK_PROTOCOLS = ['https:', 'mailto:'] as const;

const ALLOWED_HREF = /^(?:https:|mailto:)\S/i;

/** `href` izinli protokolle mi başlıyor (protokol adı ASCII, büyük/küçük harf duyarsız). */
export function isAllowedHref(href: unknown): href is string {
  return typeof href === 'string' && ALLOWED_HREF.test(href);
}

export const EdaLink = Mark.create({
  name: 'link',
  inclusive: false,
  keepOnSplit: false,

  addAttributes() {
    return {
      href: {
        default: null,
        validate: (value: unknown) => {
          if (value !== null && typeof value !== 'string') {
            throw new RangeError('Geçersiz href değeri.');
          }
        },
        parseHTML: (element) => element.getAttribute('href'),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[href]',
        getAttrs: (element) => (isAllowedHref(element.getAttribute('href')) ? null : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', { ...HTMLAttributes, rel: 'noopener noreferrer' }, 0];
  },
});
