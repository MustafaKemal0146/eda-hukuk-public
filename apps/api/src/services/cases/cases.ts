// Dava klasörü servisi (P20 ilk dilim): liste (imleçli, başlık/kod/esas ön eki), oluştur, oku,
// güncelle. `restricted` görünürlükte oluşturan kişi RLS ile görür; ekip yönetimi sonraki dilimdedir.
// Başlık ve kod denetim metadata'sına yazılmaz. Hono bilmez.
import type {
  CaseDtoValue,
  CaseInputValue,
  CaseListResponseValue,
  CasePatchInputValue,
  ListCasesQueryValue,
} from '@eda/contracts/api/cases';
import type { MemberRole } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import { can } from '@eda/contracts/permissions';
import type { TenantTx } from '@eda/db';
import { tr_fold } from '@eda/legal/text';
import * as repo from '../../repositories/cases/cases.ts';

export interface CasesDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
}

export interface CaseActor {
  readonly orgId: string;
  readonly userId: string;
  readonly memberRole: MemberRole;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 25;
const notFound = () => new AppError('CASE_NOT_FOUND');
const blank = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim();

function encodeCursor(r: { updatedAt: Date; id: string }): string {
  return Buffer.from(`${r.updatedAt.toISOString()}|${r.id}`).toString('base64url');
}
function decodeCursor(c: string): { updatedAt: Date; id: string } {
  const [iso, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (!iso || !id || Number.isNaN(at.getTime()) || !UUID_RE.test(id)) {
    throw new AppError('VALIDATION_CURSOR_INVALID');
  }
  return { updatedAt: at, id };
}

function dto(r: repo.CaseRow, userId: string): CaseDtoValue {
  return {
    id: r.id,
    title: r.title,
    officeFileCode: r.officeFileCode,
    esasNo: r.esasNo,
    status: r.status as CaseDtoValue['status'],
    visibility: r.visibility as CaseDtoValue['visibility'],
    openedDate: r.openedDate,
    mine: r.createdBy === userId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function createCasesService(deps: { readonly db: CasesDb }) {
  const tenant = <T>(a: CaseActor, fn: (tx: TenantTx) => Promise<T>) =>
    deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, fn);
  const guard = (a: CaseActor, perm: 'case:read' | 'case:write') => {
    if (!can({ surface: 'app', memberRole: a.memberRole }, perm).allow) {
      throw new AppError('ORG_ROLE_INSUFFICIENT');
    }
  };

  return {
    async list(a: CaseActor, q: ListCasesQueryValue): Promise<CaseListResponseValue> {
      guard(a, 'case:read');
      const limit = q.limit ?? PAGE;
      const before = q.cursor === undefined ? null : decodeCursor(q.cursor);
      const prefix = q.q === undefined || q.q === '' ? null : tr_fold(q.q);
      return tenant(a, async (tx) => {
        const rows = await repo.listCases(tx, a.orgId, {
          titlePrefix: prefix,
          status: q.status ?? null,
          before,
          limit,
        });
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return {
          items: page.map((r) => dto(r, a.userId)),
          nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
        };
      });
    },

    async create(a: CaseActor, input: CaseInputValue): Promise<CaseDtoValue> {
      guard(a, 'case:write');
      return tenant(a, async (tx) =>
        dto(
          await repo.insertCase(tx, a.orgId, {
            ownerId: a.userId,
            title: input.title,
            titleFold: tr_fold(input.title),
            officeFileCode: blank(input.officeFileCode) ?? null,
            esasNo: blank(input.esasNo) ?? null,
            visibility: input.visibility,
            openedDate: input.openedDate ?? null,
          }),
          a.userId,
        ),
      );
    },

    async get(a: CaseActor, id: string): Promise<CaseDtoValue> {
      guard(a, 'case:read');
      if (!UUID_RE.test(id)) throw notFound();
      return tenant(a, async (tx) => {
        const r = await repo.getCase(tx, a.orgId, id);
        if (r === null) throw notFound();
        return dto(r, a.userId);
      });
    },

    async patch(a: CaseActor, id: string, input: CasePatchInputValue): Promise<CaseDtoValue> {
      guard(a, 'case:write');
      if (!UUID_RE.test(id)) throw notFound();
      return tenant(a, async (tx) => {
        const officeFileCode = blank(input.officeFileCode);
        const esasNo = blank(input.esasNo);
        const r = await repo.patchCase(tx, a.orgId, id, {
          ...(input.title === undefined
            ? {}
            : { title: input.title, titleFold: tr_fold(input.title) }),
          ...(officeFileCode === undefined ? {} : { officeFileCode }),
          ...(esasNo === undefined ? {} : { esasNo }),
          ...(input.status === undefined ? {} : { status: input.status }),
        });
        if (r === null) throw notFound();
        return dto(r, a.userId);
      });
    },
  };
}

export type CasesService = ReturnType<typeof createCasesService>;
