// JSON -> ProseMirror düğümü (054 §2.6). `Node.fromJSON` izin dışı öznitelikleri sessizce atar ve
// içerik ifadesini doğrulamaz; bu yüzden önce JSON taranır (bilinmeyen tip/işaret/öznitelik, yuvalı
// liste, iç içe section), sonra `fromJSON` + `check()` try/catch içinde çağrılır.
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { type Issue, issue } from '../validate/issues.ts';
import { getEditorSchema } from './get-schema.ts';

export type ParseResult = { doc: PMNode | null; issues: Issue[] };

const LIST_TYPES = new Set(['orderedList', 'bulletList']);

type AttrSpecs = Readonly<Record<string, { validate?: unknown }>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkAttrs(
  attrs: unknown,
  specs: AttrSpecs,
  blockId: string | null,
  path: string,
  out: Issue[],
): void {
  if (attrs === undefined || attrs === null) return;
  if (!isRecord(attrs)) {
    out.push(issue('schema.attr_invalid', 'error', blockId, path));
    return;
  }
  for (const [name, value] of Object.entries(attrs)) {
    const spec = specs[name];
    if (spec === undefined) {
      out.push(issue('schema.attr_invalid', 'error', blockId, `${path}.attrs.${name}`));
      continue;
    }
    if (typeof spec.validate === 'function') {
      try {
        spec.validate(value);
      } catch {
        out.push(issue('schema.attr_invalid', 'error', blockId, `${path}.attrs.${name}`));
      }
    }
  }
}

type Walk = { schema: Schema; out: Issue[]; blockId: string | null; parents: readonly string[] };

function walk(node: unknown, path: string, ctx: Walk): void {
  const { schema, out } = ctx;
  if (!isRecord(node) || typeof node.type !== 'string') {
    out.push(issue('schema.node_invalid', 'error', ctx.blockId, path));
    return;
  }
  const type = schema.nodes[node.type];
  if (type === undefined) {
    out.push(issue('schema.node_invalid', 'error', ctx.blockId, path));
    return;
  }
  let blockId = ctx.blockId;
  if (node.type === 'section') {
    if (ctx.parents.includes('section')) {
      out.push(issue('schema.node_invalid', 'error', blockId, path));
      return;
    }
    const raw = isRecord(node.attrs) ? node.attrs.blockId : undefined;
    blockId = typeof raw === 'string' ? raw : null;
  }
  if (LIST_TYPES.has(node.type) && ctx.parents.includes('listItem')) {
    out.push(issue('list.nested', 'error', blockId, path));
    return;
  }
  checkAttrs(node.attrs, type.spec.attrs ?? {}, blockId, path, out);
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) {
      out.push(issue('schema.node_invalid', 'error', blockId, `${path}.marks`));
    } else {
      node.marks.forEach((mark, i) => {
        const markType =
          isRecord(mark) && typeof mark.type === 'string' ? schema.marks[mark.type] : undefined;
        if (markType === undefined || !isRecord(mark)) {
          out.push(issue('schema.node_invalid', 'error', blockId, `${path}.marks.${i}`));
          return;
        }
        checkAttrs(mark.attrs, markType.spec.attrs ?? {}, blockId, `${path}.marks.${i}`, out);
      });
    }
  }
  if (node.type === 'text') {
    if (typeof node.text !== 'string' || node.text.length === 0) {
      out.push(issue('schema.node_invalid', 'error', blockId, path));
    }
    return;
  }
  if (node.content === undefined) return;
  if (!Array.isArray(node.content)) {
    out.push(issue('schema.node_invalid', 'error', blockId, `${path}.content`));
    return;
  }
  const next: Walk = { ...ctx, blockId, parents: [...ctx.parents, node.type] };
  node.content.forEach((child, i) => {
    walk(child, path === '' ? `content.${i}` : `${path}.content.${i}`, next);
  });
}

/** Tam belge JSON'unu şemaya göre ayrıştırır ve denetler; hata varsa `doc` `null`. */
export function parseDocJson(json: unknown, schema: Schema = getEditorSchema()): ParseResult {
  const issues: Issue[] = [];
  if (!isRecord(json) || json.type !== 'doc') {
    return { doc: null, issues: [issue('schema.node_invalid', 'error', null, '')] };
  }
  walk(json, '', { schema, out: issues, blockId: null, parents: [] });
  if (issues.length > 0) return { doc: null, issues };
  try {
    const doc = schema.nodeFromJSON(json);
    doc.check();
    return { doc, issues };
  } catch {
    return { doc: null, issues: [issue('schema.node_invalid', 'error', null, '')] };
  }
}

/** Tek section JSON'unu ayrıştırır (op içeriği, akış bloğu). */
export function parseSectionJson(json: unknown, schema: Schema = getEditorSchema()): ParseResult {
  const parsed = parseDocJson({ type: 'doc', content: [json] }, schema);
  return { doc: parsed.doc?.firstChild ?? null, issues: parsed.issues.map(fixPath) };
}

function fixPath(i: Issue): Issue {
  return { ...i, path: i.path.replace(/^content\.0(\.|$)/, '') };
}
