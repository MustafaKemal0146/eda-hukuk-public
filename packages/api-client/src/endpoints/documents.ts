// Belge ve şablon uç noktaları istemcisi (041 §5.4, §5.6; P17b.10). Yanıtlar contracts şemalarıyla
// doğrulanır; hata gövdesi 044 zarfıdır (`ApiClientError`). Çerez kimliği ve CSRF/Origin tarayıcıya
// aittir; bu katman `fetch`'i dışarıdan alır (test ve sunucu bileşenleri için). İçerik loglanmaz.

import {
  type AiApiKeyInputValue,
  type AiKeySourceInputValue,
  AiKeysStatusDto,
  type AiKeysStatusDtoValue,
} from '@eda/contracts/api/ai-keys';
import { AnnouncementListResponse } from '@eda/contracts/api/announcements';
import {
  CalendarEventDto,
  type CalendarEventDtoValue,
  type EventInputValue,
  EventListResponse,
  type EventListResponseValue,
  type EventPatchInputValue,
  type ListEventsQueryValue,
} from '@eda/contracts/api/calendar';
import {
  CaseDto,
  type CaseDtoValue,
  type CaseInputValue,
  CaseListResponse,
  type CaseListResponseValue,
  type CasePatchInputValue,
} from '@eda/contracts/api/cases';
import {
  type CreateDocumentInputValue,
  type CreateVersionInputValue,
  type DiffQueryValue,
  DocumentDto,
  type DocumentDtoValue,
  DocumentListResponse,
  type DocumentListResponseValue,
  DocumentVersionContentDto,
  DocumentVersionDto,
  type DocumentVersionDtoValue,
  DocumentVersionListResponse,
  type ListDocumentsQueryValue,
  type ListVersionsQueryValue,
  type PatchDocumentInputValue,
  RestoreVersionResponse,
  type RestoreVersionResponseValue,
  TemplateListResponse,
} from '@eda/contracts/api/documents';
import {
  DownloadTokenResponse,
  type DownloadTokenResponseValue,
  FileDeleteResponse,
  type FileDeleteResponseValue,
  FileDto,
  type FileDtoValue,
  FileListResponse,
  type FileListResponseValue,
  FileUploadResponse,
  type FileUploadResponseValue,
  type ListCaseFilesQueryValue,
} from '@eda/contracts/api/files';
import {
  NotificationPreferencesResponse,
  type NotificationPreferencesResponseValue,
  type PutNotificationPreferencesInputValue,
} from '@eda/contracts/api/notification-preferences';
import {
  NotificationListResponse,
  type NotificationListResponseValue,
  ReadAllResponse,
  type ReadAllResponseValue,
} from '@eda/contracts/api/notifications';
import {
  type DraftSaveRequestDto,
  DraftSaveResponse,
  type DraftSaveResponseDto,
  VersionDiffResponse,
  type VersionDiffResponseDto,
} from '@eda/contracts/document-io';
import type { DocumentKind, DocumentSubtype } from '@eda/contracts/enums';
import { ApiErrorEnvelope, type ErrorCode } from '@eda/contracts/errors';

export class ApiClientError extends Error {
  override name = 'ApiClientError';
  readonly status: number;
  readonly code: ErrorCode | 'UNKNOWN';
  readonly reason: string | null;
  readonly meta: Readonly<Record<string, unknown>> | null;
  readonly requestId: string | null;

  constructor(
    status: number,
    code: ErrorCode | 'UNKNOWN',
    reason: string | null,
    meta: Readonly<Record<string, unknown>> | null,
    requestId: string | null,
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.meta = meta;
    this.requestId = requestId;
  }
}

export interface ClientOptions {
  /** Varsayılan: göreli (`/api/v1/...`). */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** İsteğe bağlı ek başlıklar (ör. sunucu bileşeninde çerez). */
  readonly headers?: () => Record<string, string>;
}

/** Zod şemalarının ortak yüzü; istemci paketi zod'a doğrudan bağımlı olmaz. */
type Query = Record<string, string | number | undefined>;

function qs(q: Query | undefined): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
}

export function createDocumentsClient(opts: ClientOptions = {}) {
  const base = `${opts.baseUrl ?? ''}/api/v1`;
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  async function call<T>(
    schema: { parse(data: unknown): T },
    method: string,
    path: string,
    init: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers?.() };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const res = await doFetch(`${base}${path}${qs(init.query)}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (!res.ok) throw await toError(res);
    return schema.parse(await res.json());
  }

  /** Çok parçalı gövde: `content-type` ve sınır tarayıcıya aittir (elle yazılmaz). */
  async function callForm<T>(
    schema: { parse(data: unknown): T },
    path: string,
    form: FormData,
  ): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', ...opts.headers?.() },
      credentials: 'same-origin',
      body: form,
    });
    if (!res.ok) throw await toError(res);
    return schema.parse(await res.json());
  }

  async function callNoContent(method: string, path: string): Promise<void> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { accept: 'application/json', ...opts.headers?.() },
      credentials: 'same-origin',
    });
    if (!res.ok) throw await toError(res);
  }

  const id = (v: string) => encodeURIComponent(v);

  return {
    documents: {
      list: (q: Partial<ListDocumentsQueryValue> = {}): Promise<DocumentListResponseValue> =>
        call(DocumentListResponse, 'GET', '/documents', { query: q }),
      create: (input: CreateDocumentInputValue): Promise<DocumentDtoValue> =>
        call(DocumentDto, 'POST', '/documents', { body: input }),
      get: (documentId: string): Promise<DocumentDtoValue> =>
        call(DocumentDto, 'GET', `/documents/${id(documentId)}`),
      patch: (documentId: string, input: PatchDocumentInputValue): Promise<DocumentDtoValue> =>
        call(DocumentDto, 'PATCH', `/documents/${id(documentId)}`, { body: input }),
      remove: (documentId: string): Promise<void> =>
        callNoContent('DELETE', `/documents/${id(documentId)}`),
      saveDraft: (documentId: string, req: DraftSaveRequestDto): Promise<DraftSaveResponseDto> =>
        call(DraftSaveResponse, 'PUT', `/documents/${id(documentId)}/draft`, { body: req }),
      listVersions: (documentId: string, q: Partial<ListVersionsQueryValue> = {}) =>
        call(DocumentVersionListResponse, 'GET', `/documents/${id(documentId)}/versions`, {
          query: q,
        }),
      createVersion: (
        documentId: string,
        input: CreateVersionInputValue = {},
      ): Promise<DocumentVersionDtoValue> =>
        call(DocumentVersionDto, 'POST', `/documents/${id(documentId)}/versions`, { body: input }),
      getVersion: (documentId: string, versionId: string) =>
        call(
          DocumentVersionContentDto,
          'GET',
          `/documents/${id(documentId)}/versions/${id(versionId)}`,
        ),
      restoreVersion: (
        documentId: string,
        versionId: string,
      ): Promise<RestoreVersionResponseValue> =>
        call(
          RestoreVersionResponse,
          'POST',
          `/documents/${id(documentId)}/versions/${id(versionId)}/restore`,
        ),
      diff: (documentId: string, q: DiffQueryValue): Promise<VersionDiffResponseDto> =>
        call(VersionDiffResponse, 'GET', `/documents/${id(documentId)}/diff`, { query: q }),
    },
    cases: {
      list: (
        q: { q?: string; status?: string; cursor?: string; limit?: number } = {},
      ): Promise<CaseListResponseValue> =>
        call(CaseListResponse, 'GET', '/cases', {
          query: {
            ...(q.q ? { q: q.q } : {}),
            ...(q.status ? { status: q.status } : {}),
            ...(q.cursor ? { cursor: q.cursor } : {}),
            ...(q.limit === undefined ? {} : { limit: q.limit }),
          },
        }),
      create: (input: CaseInputValue): Promise<CaseDtoValue> =>
        call(CaseDto, 'POST', '/cases', { body: input }),
      get: (caseId: string): Promise<CaseDtoValue> => call(CaseDto, 'GET', `/cases/${id(caseId)}`),
      patch: (caseId: string, input: CasePatchInputValue): Promise<CaseDtoValue> =>
        call(CaseDto, 'PATCH', `/cases/${id(caseId)}`, { body: input }),
    },
    files: {
      /** Metin alanları önce, `file` en sonda eklenir (sunucu bu sırayı ister; 033 §6.1). */
      upload: (input: {
        readonly file: Blob;
        readonly name: string;
        readonly caseId?: string;
        readonly origin?: 'chat_attachment' | 'kunye_check' | 'document_import';
        readonly originId?: string;
        readonly batch?: boolean;
      }): Promise<FileUploadResponseValue> => {
        const form = new FormData();
        if (input.caseId !== undefined) form.append('caseId', input.caseId);
        if (input.origin !== undefined) form.append('origin', input.origin);
        if (input.originId !== undefined) form.append('originId', input.originId);
        if (input.batch !== undefined) form.append('batch', String(input.batch));
        form.append('file', input.file, input.name);
        return callForm(FileUploadResponse, '/files', form);
      },
      get: (fileId: string): Promise<FileDtoValue> => call(FileDto, 'GET', `/files/${id(fileId)}`),
      listForCase: (
        caseId: string,
        q: Partial<ListCaseFilesQueryValue> = {},
      ): Promise<FileListResponseValue> =>
        call(FileListResponse, 'GET', `/cases/${id(caseId)}/files`, {
          query: {
            ...(q.status ? { status: q.status } : {}),
            ...(q.cursor ? { cursor: q.cursor } : {}),
            ...(q.limit === undefined ? {} : { limit: q.limit }),
          },
        }),
      remove: (fileId: string): Promise<FileDeleteResponseValue> =>
        call(FileDeleteResponse, 'DELETE', `/files/${id(fileId)}`),
      /**
       * Tek kullanımlık indirme bağlantısı (60 sn): yanıttaki göreli `url` tarayıcıda açılır.
       * Belirteç yetki vermez; oturum çerezi her indirmede yeniden denetlenir (033 §10.4).
       */
      downloadToken: (
        fileId: string,
        variant: 'orig' | 'searchable' | 'clean' = 'orig',
      ): Promise<DownloadTokenResponseValue> =>
        call(DownloadTokenResponse, 'POST', `/files/${id(fileId)}/download-token`, {
          body: { variant },
        }),
    },
    calendar: {
      listEvents: (q: ListEventsQueryValue): Promise<EventListResponseValue> =>
        call(EventListResponse, 'GET', '/calendar/events', { query: q }),
      createEvent: (input: EventInputValue): Promise<CalendarEventDtoValue> =>
        call(CalendarEventDto, 'POST', '/calendar/events', { body: input }),
      patchEvent: (eventId: string, input: EventPatchInputValue): Promise<CalendarEventDtoValue> =>
        call(CalendarEventDto, 'PATCH', `/calendar/events/${id(eventId)}`, { body: input }),
      deleteEvent: (eventId: string): Promise<void> =>
        callNoContent('DELETE', `/calendar/events/${id(eventId)}`),
    },
    aiKeys: {
      status: (): Promise<AiKeysStatusDtoValue> => call(AiKeysStatusDto, 'GET', '/ai-keys'),
      setOrg: (input: AiApiKeyInputValue): Promise<AiKeysStatusDtoValue> =>
        call(AiKeysStatusDto, 'PUT', '/ai-keys/org', { body: input }),
      removeOrg: (): Promise<AiKeysStatusDtoValue> =>
        call(AiKeysStatusDto, 'DELETE', '/ai-keys/org'),
      setOwn: (input: AiApiKeyInputValue): Promise<AiKeysStatusDtoValue> =>
        call(AiKeysStatusDto, 'PUT', '/ai-keys/own', { body: input }),
      removeOwn: (): Promise<AiKeysStatusDtoValue> =>
        call(AiKeysStatusDto, 'DELETE', '/ai-keys/own'),
      setSource: (input: AiKeySourceInputValue): Promise<AiKeysStatusDtoValue> =>
        call(AiKeysStatusDto, 'PUT', '/ai-keys/source', { body: input }),
    },
    notifications: {
      list: (
        q: { cursor?: string; limit?: number; unread?: boolean } = {},
      ): Promise<NotificationListResponseValue> =>
        call(NotificationListResponse, 'GET', '/notifications', {
          query: {
            ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
            ...(q.limit === undefined ? {} : { limit: q.limit }),
            ...(q.unread === undefined ? {} : { unread: String(q.unread) }),
          },
        }),
      markRead: (id: string): Promise<void> =>
        callNoContent('POST', `/notifications/${encodeURIComponent(id)}/read`),
      readAll: (): Promise<ReadAllResponseValue> =>
        call(ReadAllResponse, 'POST', '/notifications/read-all'),
      preferences: (): Promise<NotificationPreferencesResponseValue> =>
        call(NotificationPreferencesResponse, 'GET', '/notifications/preferences'),
      putPreferences: (
        input: PutNotificationPreferencesInputValue,
      ): Promise<NotificationPreferencesResponseValue> =>
        call(NotificationPreferencesResponse, 'PUT', '/notifications/preferences', {
          body: input,
        }),
    },
    announcements: {
      /** Şu an etkin duyurular (salt okur; `GET /announcements`). */
      active: () => call(AnnouncementListResponse, 'GET', '/announcements'),
    },
    templates: {
      list: (q: { kind?: DocumentKind; subtype?: DocumentSubtype } = {}) =>
        call(TemplateListResponse, 'GET', '/templates', { query: q }),
    },
  };
}

export type DocumentsClient = ReturnType<typeof createDocumentsClient>;

async function toError(res: Response): Promise<ApiClientError> {
  try {
    const parsed = ApiErrorEnvelope.safeParse(await res.json());
    if (parsed.success) {
      const e = parsed.data.error;
      return new ApiClientError(res.status, e.code, e.reason, e.meta ?? null, e.requestId);
    }
  } catch {
    // gövde JSON değil
  }
  return new ApiClientError(res.status, 'UNKNOWN', null, null, null);
}
