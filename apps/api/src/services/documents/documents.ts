// Belge servisi (054 §3.2, §8–§10; 041 §5.4; P17b). Sunucu otoritedir: blok `rev`, sürümleme, durum
// kuralları ve kilitler burada uygulanır; LLM, kredi ve dışa aktarım YOKTUR. Hono bilmez. Her DB
// erişimi tek `withTenant` işlemidir; içerik (`draft`, sürüm `content`) günlüğe, span'a, kuyruğa
// yazılmaz. İzin ve rol denetimi ara katmandaki gibi servis girişinde de yapılır (savunma derinliği;
// assistant belge içeriğine erişemez, Y-41).

import type {
  CreateDocumentInputValue,
  CreateVersionInputValue,
  DiffQueryValue,
  DocumentDtoValue,
  DocumentListResponseValue,
  DocumentVersionDtoValue,
  ListDocumentsQueryValue,
  ListVersionsQueryValue,
  PatchDocumentInputValue,
  RestoreVersionResponseValue,
  TemplateDtoValue,
} from '@eda/contracts/api/documents';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type {
  DraftSaveRequestDto,
  DraftSaveResponseDto,
  VersionDiffResponseDto,
} from '@eda/contracts/document-io';
import {
  type DocumentKind,
  type DocumentSubtype,
  KUNYE_STATUSES,
  type MemberRole,
  type VerificationStatus,
} from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import { can, type Permission } from '@eda/contracts/permissions';
import type { TenantTx } from '@eda/db';
import { blockDiff } from '@eda/editor/diff';
import { docHash } from '@eda/editor/hash';
import { newBlockId, parseDocJson } from '@eda/editor/schema';
import {
  hasErrors,
  jsonByteLength,
  schemaInvalidReason,
  validateDocJson,
} from '@eda/editor/validate';
import { tr_fold } from '@eda/legal/text';
import * as citationRepo from '../../repositories/documents/citations.ts';
import * as docRepo from '../../repositories/documents/documents.ts';
import type {
  DocumentListRow,
  DocumentRow,
  VersionRow,
} from '../../repositories/documents/rows.ts';
import * as templateRepo from '../../repositories/documents/templates.ts';
import * as versionRepo from '../../repositories/documents/versions.ts';
import {
  type CitationVerifyPort,
  NOOP_CITATION_VERIFY,
  registerDocumentCitations,
} from './citation-registry.ts';
import { citationNodesOf, computeBlockRevs, type DocJson } from './rev.ts';
import { contentLockReason, planTransition, resetsToDraftOnEdit } from './status-rules.ts';

export interface DocumentsDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
}

export interface DocumentActor {
  readonly orgId: string;
  readonly userId: string;
  readonly memberRole: MemberRole;
  readonly verificationStatus: VerificationStatus;
}

export interface DocumentsServiceDeps {
  readonly db: DocumentsDb;
  /** P13'e dek işlemsiz. */
  readonly citationVerify?: CitationVerifyPort;
  readonly now?: () => Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d === null ? null : d.toISOString());

function require_(actor: DocumentActor, permission: Permission): void {
  const d = can({ surface: 'app', memberRole: actor.memberRole }, permission);
  if (!d.allow) throw new AppError('ORG_ROLE_INSUFFICIENT');
}

const notFound = () => new AppError('DOC_NOT_FOUND');

// ---------- imleç ----------

interface CursorPayload {
  s: string;
  k: string;
  id: string;
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

function decodeCursor(raw: string, sort: string): { k: string; id: string } {
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<CursorPayload>;
    if (p.s === sort && typeof p.k === 'string' && typeof p.id === 'string' && UUID_RE.test(p.id)) {
      return { k: p.k, id: p.id };
    }
  } catch {
    // aşağıda ortak hata
  }
  throw new AppError('VALIDATION_CURSOR_INVALID');
}

function versionCursor(raw: string): number {
  const n = Number(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!Number.isInteger(n) || n < 1) throw new AppError('VALIDATION_CURSOR_INVALID');
  return n;
}

// ---------- DTO ----------

function versionDto(v: VersionRow): DocumentVersionDtoValue {
  return {
    id: v.id,
    versionNo: v.versionNo,
    source: v.source,
    trigger: v.trigger,
    name: v.name,
    baseDraftRev: v.baseDraftRev,
    createdBy: v.createdBy,
    createdAt: iso(v.createdAt),
  };
}

function listDto(r: DocumentListRow) {
  return {
    id: r.id,
    kind: r.kind,
    subtype: r.subtype,
    status: r.status,
    title: r.title,
    caseId: r.caseId,
    ownerId: r.ownerId,
    draftRev: r.draftRev,
    generationStatus: r.generationStatus,
    lastExportedAt: isoOrNull(r.lastExportedAt),
    updatedAt: iso(r.updatedAt),
    createdAt: iso(r.createdAt),
  };
}

function emptyDraft(): DocJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'section',
        attrs: { blockId: newBlockId(), rev: 1, role: 'freeSection' },
        content: [{ type: 'paragraph' }],
      },
    ],
  };
}

function istanbulDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d);
}

export function createDocumentsService(deps: DocumentsServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const verify = deps.citationVerify ?? NOOP_CITATION_VERIFY;
  const sessionMin = CONFIG_DEFAULTS['editor.versionSessionMin'];
  const limits = {
    maxBlocks: CONFIG_DEFAULTS['editor.maxBlocks'],
    maxDraftBytes: CONFIG_DEFAULTS['editor.maxDraftBytes'],
  };
  const tenant = <T>(a: DocumentActor, fn: (tx: TenantTx) => Promise<T>) =>
    deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, fn);

  async function load(tx: TenantTx, a: DocumentActor, id: string, lock = false) {
    if (!UUID_RE.test(id)) throw notFound();
    const doc = await docRepo.getDocument(tx, a.orgId, id, { lock, sessionMin });
    if (doc === null) throw notFound();
    return doc;
  }

  async function toDto(
    tx: TenantTx,
    a: DocumentActor,
    doc: DocumentRow,
  ): Promise<DocumentDtoValue> {
    const counted = await citationRepo.countCitationsByStatus(tx, a.orgId, doc.id);
    // Kümedeki her durum bulunur (sayaç 0 olsa da; 041 `Record<CitationStatus, number>`).
    const byStatus = Object.fromEntries(KUNYE_STATUSES.map((st) => [st, counted[st] ?? 0]));
    const pending = await docRepo.countPendingSuggestions(tx, a.orgId, doc.id);
    return {
      ...listDto(doc),
      sourceConversationId: doc.sourceConversationId,
      respondsToFileId: doc.respondsToFileId,
      templateId: doc.templateId,
      draft: doc.draft as DocumentDtoValue['draft'],
      draftSavedAt: isoOrNull(doc.draftSavedAt),
      outline: (doc.outline ?? null) as DocumentDtoValue['outline'],
      approvedAt: isoOrNull(doc.approvedAt),
      filedDeclaredAt: isoOrNull(doc.filedDeclaredAt),
      citations: {
        total: Object.values(byStatus).reduce((s, n) => s + n, 0),
        byStatus: byStatus as DocumentDtoValue['citations']['byStatus'],
      },
      pendingSuggestionCount: pending,
      suggestions: [],
    };
  }

  /** Kilit sırası: üretim sürüyor → 423; durum kilidi → 423 (054 §10.4, §9.6). */
  function assertWritable(doc: DocumentRow): void {
    if (doc.generationStatus !== 'idle') {
      throw new AppError('DOC_LOCKED', { reason: 'generation_in_progress', actions: ['wait'] });
    }
    const reason = contentLockReason(doc.status);
    if (reason !== null) throw new AppError('DOC_LOCKED', { reason, actions: ['wait'] });
  }

  function storedDoc(doc: DocumentRow): DocJson | null {
    const p = parseDocJson(doc.draft);
    return (p.doc?.toJSON() as DocJson | undefined) ?? (doc.draft as DocJson | null);
  }

  /** Taslak içeriği son sürümden farklı mı (kayıtsız değişiklik)? */
  async function draftDiffersFromLastVersion(
    tx: TenantTx,
    a: DocumentActor,
    doc: DocumentRow,
  ): Promise<boolean> {
    const last = await versionRepo.getLatestVersion(tx, a.orgId, doc.id);
    if (last === null) return doc.draftRev > 0;
    return (await docHash(doc.draft)) !== (await docHash(last.content));
  }

  return {
    async list(a: DocumentActor, q: ListDocumentsQueryValue): Promise<DocumentListResponseValue> {
      require_(a, 'document:read');
      const cursor = q.cursor === undefined ? null : decodeCursor(q.cursor, q.sort);
      return tenant(a, async (tx) => {
        if (q.caseId !== undefined) {
          const facts = await docRepo.getCaseFacts(tx, a.orgId, q.caseId);
          if (facts === null) throw new AppError('CASE_NOT_FOUND');
        }
        const { rows, keys } = await docRepo.listDocuments(
          tx,
          a.orgId,
          { kind: q.kind, status: q.status, caseId: q.caseId },
          q.sort,
          cursor,
          q.limit,
        );
        const page = rows.slice(0, q.limit);
        const last = page.at(-1);
        const more = rows.length > q.limit && last !== undefined;
        return {
          items: page.map(listDto),
          nextCursor: more
            ? encodeCursor({ s: q.sort, k: keys[page.length - 1] as string, id: last.id })
            : null,
        };
      });
    },

    async create(a: DocumentActor, input: CreateDocumentInputValue): Promise<DocumentDtoValue> {
      require_(a, 'document:write');
      return tenant(a, async (tx) => {
        if (input.caseId !== undefined) {
          const facts = await docRepo.getCaseFacts(tx, a.orgId, input.caseId);
          if (facts === null) throw new AppError('CASE_NOT_FOUND');
        }
        let draft: DocJson = emptyDraft();
        let subtype: DocumentSubtype | null = input.subtype ?? null;
        if (input.templateId !== undefined) {
          const tpl = await templateRepo.getTemplateContent(tx, a.orgId, input.templateId);
          if (tpl === null) {
            throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'template' });
          }
          if (tpl.kind !== input.kind) {
            throw new AppError('VALIDATION_FAILED', {
              fields: [{ path: 'body.templateId', issue: 'invalid_enum' }],
            });
          }
          subtype = subtype ?? tpl.subtype;
          draft = instantiateTemplate(tpl.content);
        }
        const doc = await docRepo.insertDocument(tx, a.orgId, {
          ownerId: a.userId,
          caseId: input.caseId ?? null,
          kind: input.kind as DocumentKind,
          subtype,
          templateId: input.templateId ?? null,
          title: input.title,
          titleFold: tr_fold(input.title),
          draft,
        });
        return toDto(tx, a, doc);
      });
    },

    async get(a: DocumentActor, id: string): Promise<DocumentDtoValue> {
      require_(a, 'document:read');
      return tenant(a, async (tx) => toDto(tx, a, await load(tx, a, id)));
    },

    async patch(
      a: DocumentActor,
      id: string,
      input: PatchDocumentInputValue,
    ): Promise<DocumentDtoValue> {
      require_(a, 'document:write');
      return tenant(a, async (tx) => {
        const doc = await load(tx, a, id, true);
        if (input.status !== undefined) {
          if (doc.generationStatus !== 'idle') {
            throw new AppError('DOC_LOCKED', {
              reason: 'generation_in_progress',
              actions: ['wait'],
            });
          }
          const verdict = planTransition(doc.status, input.status);
          if (!verdict.ok) {
            if (verdict.reason === 'invalid_target') {
              throw new AppError('VALIDATION_FAILED', {
                fields: [{ path: 'body.status', issue: 'invalid_enum' }],
              });
            }
            throw new AppError('VALIDATION_CONFLICT', { reason: 'state_changed' });
          }
          if (verdict.needsConfirm && input.confirm !== true) {
            throw new AppError('VALIDATION_FAILED', {
              fields: [{ path: 'body.confirm', issue: 'required' }],
            });
          }
          if (verdict.needsApprovePermission) require_(a, 'document:approve');
          await docRepo.updateStatus(tx, a.orgId, id, { status: input.status, actorId: a.userId });
        }
        if (input.title !== undefined) {
          await docRepo.updateTitle(tx, a.orgId, id, input.title, tr_fold(input.title));
        }
        return toDto(tx, a, await load(tx, a, id));
      });
    },

    async remove(a: DocumentActor, id: string): Promise<void> {
      require_(a, 'document:delete');
      await tenant(a, async (tx) => {
        const doc = await load(tx, a, id, true);
        const manager = a.memberRole === 'owner' || a.memberRole === 'admin';
        if (doc.ownerId !== a.userId && !manager) throw new AppError('ORG_ROLE_INSUFFICIENT');
        if (doc.generationStatus !== 'idle') {
          throw new AppError('DOC_LOCKED', { reason: 'generation_in_progress', actions: ['wait'] });
        }
        const facts =
          doc.caseId === null ? null : await docRepo.getCaseFacts(tx, a.orgId, doc.caseId);
        if ((await docRepo.getOrgLegalHold(tx, a.orgId)) || facts?.legalHold === true) {
          throw new AppError('DOC_DELETE_BLOCKED', { reason: 'legal_hold' });
        }
        if (facts?.archived === true) {
          throw new AppError('DOC_DELETE_BLOCKED', { reason: 'case_archived' });
        }
        await docRepo.deleteDocument(tx, a.orgId, id);
      });
    },

    async saveDraft(
      a: DocumentActor,
      id: string,
      req: DraftSaveRequestDto,
    ): Promise<DraftSaveResponseDto> {
      require_(a, 'document:write');
      return tenant(a, async (tx) => {
        const doc = await load(tx, a, id);
        assertWritable(doc);

        // Gövde boyutu → şema + doğrulayıcı (054 §9.2 sırası).
        if (jsonByteLength(req.draft) > limits.maxDraftBytes) {
          throw new AppError('DOC_SCHEMA_INVALID', { reason: 'size_limit' });
        }
        const checked = validateDocJson(req.draft, {
          kind: doc.kind,
          profile: 'user',
          limits,
        });
        if (checked.doc === null || hasErrors(checked.issues)) {
          throw new AppError('DOC_SCHEMA_INVALID', {
            reason: schemaInvalidReason(checked.issues) ?? 'node_invalid',
          });
        }
        const incoming = checked.doc.toJSON() as DocJson;
        const nodes = citationNodesOf(incoming);
        if (nodes.some((n) => !UUID_RE.test(n.citationId))) {
          throw new AppError('DOC_SCHEMA_INVALID', { reason: 'node_invalid' });
        }

        const stored = storedDoc(doc);
        const sessionEnd = doc.sessionExpired && (await draftDiffersFromLastVersion(tx, a, doc));
        const { doc: next, blockRevs } = await computeBlockRevs(stored, incoming);
        const changed = stored === null || (await docHash(stored)) !== (await docHash(next));

        const written = await docRepo.casWriteDraft(tx, a.orgId, id, {
          draft: next,
          baseRev: req.baseVersion,
          expectStatus: doc.status,
          resetToDraft: changed && resetsToDraftOnEdit(doc.status),
        });
        if (written === null) {
          // Sürüm yarışı (409) ile eşzamanlı durum/kilit değişimi (423) ayrılır.
          const cur = await load(tx, a, id);
          assertWritable(cur);
          throw new AppError('DOC_VERSION_CONFLICT', {
            actions: ['merge_changes', 'reload'],
            meta: { currentVersion: cur.draftRev },
          });
        }

        let versionCreated: DraftSaveResponseDto['versionCreated'] = null;
        if (sessionEnd) {
          const v = await versionRepo.insertVersion(tx, a.orgId, {
            documentId: id,
            source: 'user',
            trigger: 'session_end',
            name: null,
            content: doc.draft,
            baseDraftRev: doc.draftRev,
            createdBy: a.userId,
          });
          versionCreated = { versionNo: v.versionNo, trigger: 'session_end' };
        }

        const reg = await registerDocumentCitations(
          tx,
          {
            orgId: a.orgId,
            documentId: id,
            today: istanbulDay(now()),
            verify,
            gen: Math.floor(now().getTime() / 1000),
          },
          nodes,
        );
        return {
          draftRev: written.draftRev,
          savedAt: iso(written.savedAt),
          blockRevs,
          citations: reg.changed.map((c) => ({
            citationId: c.id,
            status: c.status,
            blocking: c.blocking,
            shortKunye: null,
            reason: c.reason,
          })),
          warnings: checked.issues.filter((i) => i.severity === 'warning'),
          versionCreated,
        };
      });
    },

    async listVersions(a: DocumentActor, id: string, q: ListVersionsQueryValue) {
      require_(a, 'document:read');
      const before = q.cursor === undefined ? null : versionCursor(q.cursor);
      return tenant(a, async (tx) => {
        await load(tx, a, id);
        const rows = await versionRepo.listVersions(tx, a.orgId, id, before, q.limit);
        const page = rows.slice(0, q.limit);
        const last = page.at(-1);
        return {
          items: page.map(versionDto),
          nextCursor:
            rows.length > q.limit && last !== undefined
              ? Buffer.from(String(last.versionNo), 'utf8').toString('base64url')
              : null,
        };
      });
    },

    async createVersion(
      a: DocumentActor,
      id: string,
      input: CreateVersionInputValue,
    ): Promise<{ created: boolean; version: DocumentVersionDtoValue }> {
      require_(a, 'document:write');
      return tenant(a, async (tx) => {
        const doc = await load(tx, a, id, true);
        const last = await versionRepo.getLatestVersion(tx, a.orgId, id);
        if (last !== null && (await docHash(last.content)) === (await docHash(doc.draft))) {
          // Tekilleştirme: aynı içerik yeni sürüm üretmez; boş adı verilen ad doldurur.
          if (input.name !== undefined && last.name === null) {
            const named = await versionRepo.setVersionName(tx, a.orgId, last.id, input.name);
            if (named !== null) return { created: false, version: versionDto(named) };
          }
          return { created: false, version: versionDto(last) };
        }
        const v = await versionRepo.insertVersion(tx, a.orgId, {
          documentId: id,
          source: 'user',
          trigger: 'manual',
          name: input.name ?? null,
          content: doc.draft,
          baseDraftRev: doc.draftRev,
          createdBy: a.userId,
        });
        return { created: true, version: versionDto(v) };
      });
    },

    async getVersion(a: DocumentActor, id: string, versionId: string) {
      require_(a, 'document:read');
      return tenant(a, async (tx) => {
        await load(tx, a, id);
        if (!UUID_RE.test(versionId)) throw notFound();
        const v = await versionRepo.getVersion(tx, a.orgId, id, versionId);
        if (v === null) throw notFound();
        return { ...versionDto(v), content: v.content as DocumentDtoValue['draft'] };
      });
    },

    async restoreVersion(
      a: DocumentActor,
      id: string,
      versionId: string,
    ): Promise<RestoreVersionResponseValue> {
      require_(a, 'document:write');
      return tenant(a, async (tx) => {
        const doc = await load(tx, a, id, true);
        assertWritable(doc);
        if (!UUID_RE.test(versionId)) throw notFound();
        const target = await versionRepo.getVersion(tx, a.orgId, id, versionId);
        if (target === null) throw notFound();
        const parsed = parseDocJson(target.content);
        if (parsed.doc === null)
          throw new AppError('DOC_SCHEMA_INVALID', { reason: 'node_invalid' });

        // Kayıtsız değişiklik varsa önce `session_end` sürümü (054 §8.4).
        if (await draftDiffersFromLastVersion(tx, a, doc)) {
          await versionRepo.insertVersion(tx, a.orgId, {
            documentId: id,
            source: 'user',
            trigger: 'session_end',
            name: null,
            content: doc.draft,
            baseDraftRev: doc.draftRev,
            createdBy: a.userId,
          });
        }
        const { doc: next, blockRevs } = await computeBlockRevs(
          storedDoc(doc),
          parsed.doc.toJSON() as DocJson,
        );
        const changed = (await docHash(doc.draft)) !== (await docHash(next));
        const written = await docRepo.casWriteDraft(tx, a.orgId, id, {
          draft: next,
          baseRev: doc.draftRev,
          expectStatus: doc.status,
          resetToDraft: changed && resetsToDraftOnEdit(doc.status),
        });
        if (written === null) {
          throw new AppError('DOC_VERSION_CONFLICT', {
            actions: ['merge_changes', 'reload'],
            meta: { currentVersion: (await load(tx, a, id)).draftRev },
          });
        }
        const v = await versionRepo.insertVersion(tx, a.orgId, {
          documentId: id,
          source: 'user',
          trigger: 'restore',
          name: null,
          content: next,
          baseDraftRev: written.draftRev,
          createdBy: a.userId,
        });
        await docRepo.markPendingSuggestionsStale(tx, a.orgId, id);
        return { draftRev: written.draftRev, version: versionDto(v), blockRevs };
      });
    },

    async diff(a: DocumentActor, id: string, q: DiffQueryValue): Promise<VersionDiffResponseDto> {
      require_(a, 'document:read');
      if (q.from === q.to) {
        throw new AppError('VALIDATION_FAILED', {
          fields: [{ path: 'query.to', issue: 'invalid_range' }],
        });
      }
      return tenant(a, async (tx) => {
        const doc = await load(tx, a, id);
        const side = async (ref: string) => {
          if (ref === 'draft') {
            return {
              versionNo: null,
              createdAt: iso(doc.draftSavedAt ?? doc.updatedAt),
              content: doc.draft as DocJson,
            };
          }
          const v = await versionRepo.getVersion(tx, a.orgId, id, ref);
          if (v === null) throw notFound();
          return {
            versionNo: v.versionNo,
            createdAt: iso(v.createdAt),
            content: v.content as DocJson,
          };
        };
        const from = await side(q.from);
        const to = await side(q.to);
        const d = blockDiff(from.content, to.content);
        return {
          from: { versionNo: from.versionNo, createdAt: from.createdAt },
          to: { versionNo: to.versionNo, createdAt: to.createdAt },
          blocks: d.blocks as VersionDiffResponseDto['blocks'],
          unchangedCount: d.unchangedCount,
        };
      });
    },

    async listTemplates(
      a: DocumentActor,
      q: { kind?: DocumentKind | undefined; subtype?: DocumentSubtype | undefined },
    ): Promise<{ items: TemplateDtoValue[] }> {
      // Platform şablonları araştırma izniyle; büro şablonları belge okuma izniyle (041 §5.6).
      require_(a, 'research:use');
      return tenant(a, async (tx) => {
        const rows = await templateRepo.listTemplates(tx, a.orgId, {
          kind: q.kind,
          subtype: q.subtype,
          // Meslek doğrulaması bekleyen kullanıcıya yalnız platform şablonları açıktır (091).
          platformOnly: a.verificationStatus !== 'verified',
        });
        return {
          items: rows.map((t) => ({
            id: t.id,
            orgId: t.orgId,
            kind: t.kind,
            subtype: t.subtype,
            title: t.title,
            description: t.description,
            caseTypeCode: t.caseTypeCode,
            version: t.version,
            isActive: t.isActive,
            updatedAt: iso(t.updatedAt),
          })),
        };
      });
    },
  };
}

export type DocumentsService = ReturnType<typeof createDocumentsService>;

/** Şablon içeriği: her `section` yeni `blockId` ve `rev = 1` alır (P17b.4; doldurma P18a'da). */
export function instantiateTemplate(content: unknown): DocJson {
  const parsed = parseDocJson(content);
  if (parsed.doc === null) throw new AppError('DOC_SCHEMA_INVALID', { reason: 'node_invalid' });
  const json = parsed.doc.toJSON() as DocJson;
  const used = new Set<string>();
  const sections = json.content.map((s) => {
    const id = newBlockId(used);
    used.add(id);
    return { ...s, attrs: { ...s.attrs, blockId: id, rev: 1 } };
  });
  return { ...json, content: sections };
}
