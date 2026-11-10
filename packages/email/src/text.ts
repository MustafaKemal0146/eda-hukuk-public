// Düz metin sürümü (045 §7.2: zorunlu, HTML ile aynı bilgi). HTML'den dönüştürme yapılmaz; aynı
// içerik bloklarından üretilir. `security`/`deadline` sınıflarında bağlantı bloğu bulunmaz.
import { PRODUCT_NAME } from './brand.ts';
import { type EmailContent, FOOTER, greeting, SECURITY_FOOTER } from './content.ts';

export function renderText(content: EmailContent, companyName: string | null): string {
  const out: string[] = [PRODUCT_NAME, '', content.heading, '', greeting(content.greetingName), ''];
  for (const b of content.blocks) {
    switch (b.kind) {
      case 'paragraph':
      case 'notice':
        out.push(b.text, '');
        break;
      case 'keyValue':
        for (const [k, v] of b.items) out.push(`${k}: ${v}`);
        out.push('');
        break;
      case 'button':
        out.push(`${b.label}: ${b.href}`, '');
        break;
      case 'link':
        out.push(`${b.label}: ${b.href}`, '');
        break;
    }
  }
  out.push('--', content.footer ?? FOOTER);
  if (content.class === 'security') out.push(SECURITY_FOOTER);
  if (companyName !== null) out.push(companyName);
  return `${out.join('\n')}\n`;
}
