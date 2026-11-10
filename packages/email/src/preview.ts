// Yönetim paneli için salt okur şablon envanteri ve SENTETİK örnek önizleme (düz metin). Gerçek alıcı,
// belirteç veya bağlantı kullanılmaz: parametreler şema tipinden türetilen sabit örneklerdir, bağlantı
// kökü `https://ornek.invalid`, sırlar sahte yer tutucudur. HTML üretilmez .
import { z } from 'zod';
import { type CatalogCode, isCatalogCode, TEMPLATES } from './catalog.ts';
import type { EmailContent, RenderContext } from './content.ts';
import { CONTENT } from './content-map.ts';
import { renderText } from './text.ts';

export type VariableType = 'number' | 'string' | 'datetime' | 'enum';

export interface TemplateVariable {
  readonly name: string;
  readonly type: VariableType;
  /** `enum` için izinli değerler. */
  readonly options: readonly string[];
  /** Mühürlü sır (değeri hiçbir yerde gösterilmez). */
  readonly sealed: boolean;
}

export interface TemplateInventoryItem {
  readonly code: CatalogCode;
  readonly version: string;
  /** Sürüm dizesinin tarih parçası (`YYYY-MM-DD`); şablonlar kodda sürümlenir. */
  readonly versionDate: string;
  readonly class: string;
  readonly kind: string;
  readonly variables: readonly TemplateVariable[];
}

interface JsonProp {
  readonly type?: string;
  readonly format?: string;
  readonly enum?: readonly unknown[];
}

function propsOf(code: CatalogCode): Record<string, JsonProp> {
  const js = z.toJSONSchema(TEMPLATES[code].params, { io: 'input' }) as {
    properties?: Record<string, JsonProp>;
  };
  return js.properties ?? {};
}

function variableOf(name: string, p: JsonProp): TemplateVariable {
  const options = Array.isArray(p.enum) ? p.enum.map(String) : [];
  const type: VariableType =
    options.length > 0
      ? 'enum'
      : p.type === 'integer' || p.type === 'number'
        ? 'number'
        : p.format === 'date-time'
          ? 'datetime'
          : 'string';
  return { name, type, options, sealed: false };
}

export function emailTemplateInventory(): readonly TemplateInventoryItem[] {
  return (Object.keys(TEMPLATES) as CatalogCode[]).map((code) => {
    const m = TEMPLATES[code];
    const params = Object.entries(propsOf(code)).map(([n, p]) => variableOf(n, p));
    const sealed = m.secrets.map(
      (n): TemplateVariable => ({ name: n, type: 'string', options: [], sealed: true }),
    );
    return {
      code,
      version: m.version,
      versionDate: m.version.slice(0, 10),
      class: m.class,
      kind: m.kind,
      variables: [...params, ...sealed],
    };
  });
}

const SAMPLE_DATETIME = '2026-01-15T09:30:00+03:00';
const SAMPLE_NUMBER = 7;
const SAMPLE_STRING = 'ornek';
const SAMPLE_SECRET = 'ORNEK-YER-TUTUCU-0000000000';
/** Davet bağlantısı belirteç değil davet kimliği (UUID) ister. */
const SAMPLE_INVITATION_ID = '00000000-0000-4000-8000-000000000000';

function sampleParams(code: CatalogCode): unknown {
  const out: Record<string, unknown> = {};
  for (const [n, p] of Object.entries(propsOf(code))) {
    const v = variableOf(n, p);
    out[n] =
      v.type === 'enum'
        ? (v.options[0] ?? SAMPLE_STRING)
        : v.type === 'number'
          ? SAMPLE_NUMBER
          : v.type === 'datetime'
            ? SAMPLE_DATETIME
            : SAMPLE_STRING;
  }
  return out;
}

export interface TemplatePreview {
  readonly code: CatalogCode;
  readonly version: string;
  readonly subject: string;
  readonly text: string;
}

const contextOf = (code: CatalogCode): RenderContext => ({
  appUrl: 'https://ornek.invalid',
  recipientName: 'Örnek Kişi',
  secrets: { token: code === 'invitation' ? SAMPLE_INVITATION_ID : SAMPLE_SECRET },
  companyName: null,
  invitation: { orgName: 'Örnek Hukuk Bürosu', inviterName: 'Örnek Yönetici' },
});

/** Sentetik örnek verilerle konu + düz metin; kodu katalogda olmayan şablon için `null`. */
export function previewEmail(code: string): TemplatePreview | null {
  if (!isCatalogCode(code)) return null;
  const meta = TEMPLATES[code];
  const ctx = contextOf(code);
  const parsed: unknown = meta.params.parse(sampleParams(code));
  const subject = (meta.subject as (p: unknown) => string)(parsed);
  const content = (CONTENT[code] as (p: unknown, c: RenderContext) => EmailContent)(parsed, ctx);
  return { code, version: meta.version, subject, text: renderText(content, ctx.companyName) };
}
