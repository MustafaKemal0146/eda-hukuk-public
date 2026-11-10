// @tk TK-28
// P17b.10: belge istemcisi — yol/yöntem eşlemesi, gövde, şema doğrulaması ve hata zarfı.
import { describe, expect, it } from 'vitest';
import { ApiClientError, createDocumentsClient } from '../src/endpoints/documents.ts';

const DOC_ID = '0198d2a4-0000-7000-8000-0000000000d1';
const TS = '2026-10-12T10:00:00.000Z';

function recorder(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('KK-P17b-15: api-client documents', () => {
  it('liste sorgusunu yola çevirir ve yanıtı doğrular', async () => {
    const r = recorder(() => Response.json({ items: [], nextCursor: null }));
    const c = createDocumentsClient({ fetch: r.fetchFn });
    const out = await c.documents.list({ kind: 'petition', limit: 10 });
    expect(out.items).toEqual([]);
    expect(r.calls[0]?.url).toBe('/api/v1/documents?kind=petition&limit=10');
    expect(r.calls[0]?.init.method).toBe('GET');
  });

  it('taslak kaydı PUT ve gövdeyi JSON gönderir', async () => {
    const r = recorder(() =>
      Response.json({
        draftRev: 2,
        savedAt: TS,
        blockRevs: {},
        citations: [],
        warnings: [],
        versionCreated: null,
      }),
    );
    const c = createDocumentsClient({ fetch: r.fetchFn });
    await c.documents.saveDraft(DOC_ID, {
      baseVersion: 1,
      draft: { type: 'doc', content: [] },
      clientSeq: 0,
      reason: 'autosave',
    });
    expect(r.calls[0]?.url).toBe(`/api/v1/documents/${DOC_ID}/draft`);
    expect(r.calls[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(r.calls[0]?.init.body)).baseVersion).toBe(1);
  });

  it('hata zarfını ApiClientError olarak fırlatır (kod, reason, meta)', async () => {
    const r = recorder(() =>
      Response.json(
        {
          error: {
            code: 'DOC_VERSION_CONFLICT',
            message: 'Belge başka bir yerde değiştirilmiş.',
            reason: null,
            actions: ['reload'],
            meta: { currentVersion: 7 },
            requestId: 'req-12345678',
          },
        },
        { status: 409 },
      ),
    );
    const c = createDocumentsClient({ fetch: r.fetchFn });
    const err = await c.documents.get(DOC_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('DOC_VERSION_CONFLICT');
    expect((err as ApiClientError).meta).toEqual({ currentVersion: 7 });
    expect((err as ApiClientError).status).toBe(409);
  });

  it('silme 204 ile döner; sürüm geri yükleme ve fark yolları', async () => {
    const r = recorder((url) =>
      url.endsWith(`/documents/${DOC_ID}`)
        ? new Response(null, { status: 204 })
        : Response.json({}),
    );
    const c = createDocumentsClient({ fetch: r.fetchFn });
    await c.documents.remove(DOC_ID);
    expect(r.calls[0]?.init.method).toBe('DELETE');
    await c.documents.diff(DOC_ID, { from: 'draft', to: DOC_ID }).catch(() => undefined);
    expect(r.calls[1]?.url).toBe(`/api/v1/documents/${DOC_ID}/diff?from=draft&to=${DOC_ID}`);
  });

  it('şablon listesi yolu', async () => {
    const r = recorder(() => Response.json({ items: [] }));
    const c = createDocumentsClient({ fetch: r.fetchFn });
    await c.templates.list({ kind: 'petition', subtype: 'claim' });
    expect(r.calls[0]?.url).toBe('/api/v1/templates?kind=petition&subtype=claim');
  });
});

describe('KK-P20-17: api-client files', () => {
  const FILE = {
    id: DOC_ID,
    caseId: null,
    origin: 'chat_attachment',
    name: 'ek.txt',
    fileType: 'txt',
    sizeBytes: 3,
    sha256: 'a'.repeat(64),
    status: 'uploaded',
    statusReason: null,
    scanned: false,
    pageCount: null,
    hasSearchable: false,
    hasClean: false,
    progressDone: null,
    progressTotal: null,
    mine: true,
    createdAt: TS,
    updatedAt: TS,
  };

  it('yükleme çok parçalı gövde gönderir: metin alanları önce, file en sonda; content-type elle yazılmaz', async () => {
    const r = recorder(() => Response.json({ file: FILE }, { status: 201 }));
    const c = createDocumentsClient({ fetch: r.fetchFn });
    const out = await c.files.upload({
      file: new Blob(['abc']),
      name: 'ek.txt',
      caseId: DOC_ID,
      batch: true,
    });
    expect(out.file.id).toBe(DOC_ID);
    expect(r.calls[0]?.url).toBe('/api/v1/files');
    expect(r.calls[0]?.init.method).toBe('POST');
    const headers = r.calls[0]?.init.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
    const form = r.calls[0]?.init.body as FormData;
    expect([...form.keys()]).toEqual(['caseId', 'batch', 'file']);
    expect(form.get('batch')).toBe('true');
  });

  it('liste, okuma ve silme yol/yöntem eşlemesi', async () => {
    const r = recorder((url, init) =>
      init.method === 'DELETE'
        ? Response.json({ id: DOC_ID, deleteRequestedAt: TS, graceUntil: TS })
        : url.includes('/cases/')
          ? Response.json({ items: [FILE], nextCursor: null })
          : Response.json(FILE),
    );
    const c = createDocumentsClient({ fetch: r.fetchFn });
    await c.files.listForCase(DOC_ID, { limit: 5, status: 'ready' });
    await c.files.get(DOC_ID);
    await c.files.remove(DOC_ID);
    expect(r.calls.map((x) => `${x.init.method} ${x.url}`)).toEqual([
      `GET /api/v1/cases/${DOC_ID}/files?status=ready&limit=5`,
      `GET /api/v1/files/${DOC_ID}`,
      `DELETE /api/v1/files/${DOC_ID}`,
    ]);
  });

  it('indirme belirteci POST ile istenir ve göreli URL döner', async () => {
    const dt = 'A'.repeat(43);
    const r = recorder(() =>
      Response.json({ url: `/api/v1/files/${DOC_ID}/content?dt=${dt}`, expiresInSec: 60 }),
    );
    const c = createDocumentsClient({ fetch: r.fetchFn });
    const out = await c.files.downloadToken(DOC_ID);
    expect(out.expiresInSec).toBe(60);
    expect(r.calls[0]?.url).toBe(`/api/v1/files/${DOC_ID}/download-token`);
    expect(r.calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(r.calls[0]?.init.body))).toEqual({ variant: 'orig' });
  });

  it('413 FILE_TOO_LARGE zarfı ApiClientError olur', async () => {
    const r = recorder(() =>
      Response.json(
        {
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'Dosya izin verilen boyutu aşıyor.',
            reason: null,
            actions: [],
            meta: { maxBytes: 52_428_800 },
            requestId: 'req-12345678',
          },
        },
        { status: 413 },
      ),
    );
    const c = createDocumentsClient({ fetch: r.fetchFn });
    await expect(c.files.upload({ file: new Blob(['x']), name: 'x.pdf' })).rejects.toMatchObject({
      status: 413,
      code: 'FILE_TOO_LARGE',
    });
  });
});
