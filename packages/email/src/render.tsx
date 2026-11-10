// `renderEmail(code, params, ctx) -> { subject, html, text, version }` (045 §7.1). HTML elle string
// birleştirilmez; React bileşenleri `@react-email/render` ile işlenir. Düz metin aynı içerik
// bloklarından üretilir. Parametreler şablon şemasıyla (`.strict()`) yeniden doğrulanır.
import { render } from '@react-email/render';
import {
  type CatalogCode,
  isCatalogCode,
  parseTemplateParams,
  SUBJECT_MAX_LENGTH,
  TEMPLATES,
  type TemplateParams,
} from './catalog.ts';
import type { EmailContent, RenderContext } from './content.ts';
import { CONTENT } from './content-map.ts';
import { EmailLayout } from './layout.tsx';
import { renderText } from './text.ts';

export type { RenderContext } from './content.ts';

export class TemplateUnknownError extends Error {
  override name = 'TemplateUnknownError';
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly version: string;
}

export async function renderEmail(
  code: string,
  params: unknown,
  ctx: RenderContext,
): Promise<RenderedEmail> {
  if (!isCatalogCode(code)) throw new TemplateUnknownError(`şablon katalogda yok: ${code}`);
  return renderKnown(code, params, ctx);
}

async function renderKnown<C extends CatalogCode>(
  code: C,
  raw: unknown,
  ctx: RenderContext,
): Promise<RenderedEmail> {
  const params = parseTemplateParams(code, raw);
  const meta = TEMPLATES[code];
  const subject = (meta.subject as (p: TemplateParams<C>) => string)(params);
  if (subject.length > SUBJECT_MAX_LENGTH) {
    throw new Error(`konu satırı ${SUBJECT_MAX_LENGTH} karakteri aşıyor: ${code}`);
  }
  const content = (CONTENT[code] as (p: TemplateParams<C>, c: RenderContext) => EmailContent)(
    params,
    ctx,
  );
  const rendered = await render(
    <EmailLayout content={content} subject={subject} companyName={ctx.companyName} />,
  );
  // Oluşturucu XHTML 1.0 doctype'ı (uzak DTD adresi) ekler; e-posta HTML5 doctype'ıyla gönderilir.
  const html = rendered.replace(/^<!DOCTYPE[^>]*>/i, '<!DOCTYPE html>');
  return { subject, html, text: renderText(content, ctx.companyName), version: meta.version };
}
