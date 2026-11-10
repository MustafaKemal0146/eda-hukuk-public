// Belge doğrulayıcı (054 §4): aynı fonksiyon istemcide (uyarı amaçlı) ve sunucuda (otoriter) çalışır.
// `error` sorunları kaydı reddeder (422 `DOC_SCHEMA_INVALID`), `warning` sorunları engellemez.
import type { DocumentKind, SectionRole } from '@eda/contracts/enums';
import type { ReasonOf } from '@eda/contracts/errors';
import type { Node as PMNode } from '@tiptap/pm/model';
import { isAllowedHref } from '../schema/link.ts';
import { parseDocJson } from '../schema/parse-doc.ts';
import { hasForbiddenChars, isTabAllowed } from '../schema/sanitize-text.ts';
import { type Issue, type IssueCode, issue } from './issues.ts';
import { DEFAULT_EDITOR_LIMITS, type EditorLimits, jsonByteLength } from './limits.ts';
import {
  PLACEHOLDER_PATTERN,
  ROLE_RULES,
  type SectionChildType,
  SINGLETON_ROLES,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  type ValidationProfile,
} from './roles.ts';

export {
  type CheckElementsOptions,
  checkElements,
  type ElementIssue,
} from './elements.ts';
export type { Issue, IssueCode } from './issues.ts';
export { SECTION_ROLE_LABELS } from './issues.ts';
export { DEFAULT_EDITOR_LIMITS, type EditorLimits, jsonByteLength } from './limits.ts';
export {
  PLACEHOLDER_PATTERN,
  PROTECTED_ROLES,
  ROLE_RULES,
  type RoleRule,
  SINGLETON_ROLES,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  type ValidationProfile,
} from './roles.ts';

export type SectionContext = { profile: ValidationProfile; path?: string };
export type DocContext = {
  kind: DocumentKind;
  profile: ValidationProfile;
  limits?: Partial<EditorLimits>;
};

const HEADING_LEVELS: readonly unknown[] = [1, 2];

type SectionScan = {
  role: SectionRole;
  blockId: string | null;
  out: Issue[];
  seen: Set<IssueCode>;
};

/** Aynı bölümde aynı kodu bir kez raporlar (taşkın önleme). */
function once(scan: SectionScan, code: IssueCode, severity: Issue['severity'], path: string): void {
  if (scan.seen.has(code)) return;
  scan.seen.add(code);
  scan.out.push(issue(code, severity, scan.blockId, path, { role: scan.role }));
}

function scanInline(node: PMNode, path: string, scan: SectionScan): void {
  const rule = ROLE_RULES[scan.role];
  if (node.isText) {
    const text = node.text ?? '';
    if (hasForbiddenChars(text)) once(scan, 'text.forbidden_char', 'error', path);
    if (text.includes('\t') && !isTabAllowed(scan.role)) {
      once(scan, 'text.tab_not_allowed', 'warning', path);
    }
  }
  for (const mark of node.marks) {
    if (rule.marks !== null && !rule.marks.includes(mark.type.name)) {
      once(scan, 'role.mark_not_allowed', 'error', path);
    }
    if (mark.type.name === 'link' && !isAllowedHref(mark.attrs.href)) {
      once(scan, 'link.protocol', 'error', path);
    }
  }
  if (node.type.name === 'citation') {
    const id = node.attrs.citationId;
    const raw = node.attrs.raw;
    if (typeof id !== 'string' || id === '' || typeof raw !== 'string' || raw.trim() === '') {
      scan.out.push(issue('citation.missing_id', 'error', scan.blockId, path));
    }
  }
}

function scanBlock(node: PMNode, path: string, scan: SectionScan): void {
  const name = node.type.name;
  if (name === 'heading' && !HEADING_LEVELS.includes(node.attrs.level)) {
    scan.out.push(issue('schema.attr_invalid', 'error', scan.blockId, path));
  }
  if (name === 'orderedList') {
    const start = node.attrs.start;
    if (
      typeof start !== 'number' ||
      !Number.isInteger(start) ||
      start < 1 ||
      node.attrs.type !== null
    ) {
      scan.out.push(issue('schema.attr_invalid', 'error', scan.blockId, path));
    }
  }
  if (name === 'listItem') {
    node.forEach((child, _o, i) => {
      if (child.type.name !== 'paragraph') {
        scan.out.push(issue('list.nested', 'error', scan.blockId, `${path}.content.${i}`));
      }
    });
  }
  if (name === 'table') {
    let cols = 0;
    node.forEach((row) => {
      cols = Math.max(cols, row.childCount);
    });
    if (node.childCount > TABLE_MAX_ROWS || cols > TABLE_MAX_COLS) {
      scan.out.push(issue('table.limit', 'error', scan.blockId, path));
    }
  }
  if (name === 'tableCell' || name === 'tableHeader') {
    if (node.attrs.colspan !== 1 || node.attrs.rowspan !== 1) {
      once(scan, 'table.merged_cell', 'error', path);
    }
  }
  node.forEach((child, _o, i) => {
    const childPath = `${path}.content.${i}`;
    if (child.isInline) scanInline(child, childPath, scan);
    else scanBlock(child, childPath, scan);
  });
}

/** Tek blok doğrulaması (op sonrası, blok akışı sonrası; 054 §4.5). */
export function validateSection(section: PMNode, ctx: SectionContext): Issue[] {
  const path = ctx.path ?? '';
  const role = section.attrs.role as SectionRole;
  const rawId = section.attrs.blockId;
  const blockId = typeof rawId === 'string' ? rawId : null;
  const rule = ROLE_RULES[role];
  const scan: SectionScan = { role, blockId, out: [], seen: new Set() };
  const at = (i: number): string => (path === '' ? `content.${i}` : `${path}.content.${i}`);

  if (ctx.profile === 'model' && rule.model === null) {
    scan.out.push(issue('role.model_forbidden', 'error', blockId, path, { role }));
  }
  const allowed = ctx.profile === 'model' ? (rule.model ?? rule.user) : rule.user;
  section.forEach((child, _o, i) => {
    const type = child.type.name as SectionChildType;
    if (!allowed.includes(type)) {
      scan.out.push(issue('role.child_not_allowed', 'error', blockId, at(i), { role }));
    } else if (type === 'heading' && rule.headingFirstOnly && i > 0) {
      scan.out.push(issue('heading.not_first', 'error', blockId, at(i), { role }));
    }
    scanBlock(child, at(i), scan);
  });
  if (rule.maxChildren !== null && section.childCount > rule.maxChildren) {
    scan.out.push(issue('role.count', 'error', blockId, path, { role, max: rule.maxChildren }));
  }
  const text = section.textContent;
  if (text.trim() === '') scan.out.push(issue('section.empty', 'warning', blockId, path));
  if (PLACEHOLDER_PATTERN.test(text)) {
    scan.out.push(issue('placeholder.unfilled', 'warning', blockId, path));
  }
  return scan.out;
}

/** Belge doğrulaması (054 §4.1–§4.3). */
export function validateDoc(doc: PMNode, ctx: DocContext): Issue[] {
  const limits = { ...DEFAULT_EDITOR_LIMITS, ...ctx.limits };
  const out: Issue[] = [];
  if (doc.childCount > limits.maxBlocks) {
    out.push(issue('limit.block_count', 'error', null, '', { max: limits.maxBlocks }));
  }
  if (jsonByteLength(doc.toJSON()) > limits.maxDraftBytes) {
    out.push(issue('limit.draft_bytes', 'error', null, ''));
  }
  const seenIds = new Set<string>();
  const roleCount = new Map<SectionRole, number>();
  const roles: SectionRole[] = [];
  doc.forEach((section, _o, i) => {
    const path = `content.${i}`;
    const role = section.attrs.role as SectionRole;
    roles.push(role);
    const id = section.attrs.blockId;
    if (typeof id !== 'string' || id === '') {
      out.push(issue('blockId.missing', 'error', null, path));
    } else if (seenIds.has(id)) {
      out.push(issue('blockId.duplicate', 'error', id, path));
    } else {
      seenIds.add(id);
    }
    out.push(...validateSection(section, { profile: ctx.profile, path }));
    const n = (roleCount.get(role) ?? 0) + 1;
    roleCount.set(role, n);
    if (n > 1 && (SINGLETON_ROLES as readonly string[]).includes(role)) {
      out.push(
        issue('role.duplicate', 'warning', typeof id === 'string' ? id : null, path, { role }),
      );
    }
  });
  const courtAt = roles.indexOf('courtHeader');
  if (ctx.kind === 'petition' && courtAt > 0) {
    out.push(issue('order.court_header_not_first', 'warning', null, `content.${courtAt}`));
  }
  const signAt = roles.lastIndexOf('attorneySignature');
  if (signAt >= 0 && signAt !== roles.length - 1) {
    out.push(issue('order.signature_not_last', 'warning', null, `content.${signAt}`));
  }
  return out;
}

export type ValidateJsonResult = { doc: PMNode | null; issues: Issue[] };

/** JSON -> şema denetimi -> `validateDoc` (sunucu `PUT /draft` yolu). */
export function validateDocJson(json: unknown, ctx: DocContext): ValidateJsonResult {
  const limits = { ...DEFAULT_EDITOR_LIMITS, ...ctx.limits };
  if (jsonByteLength(json) > limits.maxDraftBytes) {
    return { doc: null, issues: [issue('limit.draft_bytes', 'error', null, '')] };
  }
  const parsed = parseDocJson(json);
  if (parsed.doc === null) return parsed;
  return { doc: parsed.doc, issues: validateDoc(parsed.doc, ctx) };
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

export type SchemaInvalidReason = ReasonOf<'DOC_SCHEMA_INVALID'>;

const REASON_OF: Readonly<Partial<Record<IssueCode, SchemaInvalidReason>>> = {
  'limit.draft_bytes': 'size_limit',
  'limit.block_count': 'block_limit',
  'role.child_not_allowed': 'role_rule',
  'role.count': 'role_rule',
  'role.mark_not_allowed': 'role_rule',
  'role.model_forbidden': 'role_rule',
  'heading.not_first': 'role_rule',
};
const REASON_PRIORITY: readonly SchemaInvalidReason[] = [
  'size_limit',
  'block_limit',
  'node_invalid',
  'role_rule',
];

/** `error` sorunlarından `DOC_SCHEMA_INVALID` `reason` değeri; hata yoksa `null` (054 §4.1). */
export function schemaInvalidReason(issues: readonly Issue[]): SchemaInvalidReason | null {
  const found = new Set<SchemaInvalidReason>();
  for (const i of issues) {
    if (i.severity === 'error') found.add(REASON_OF[i.code] ?? 'node_invalid');
  }
  return REASON_PRIORITY.find((r) => found.has(r)) ?? null;
}
