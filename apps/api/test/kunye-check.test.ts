// P13.12 / 025 §14 (geliştirme dilimi): Künye Kontrolü işi; sahte yargi-mcp ile doğrulanan, yakın
// eşleşen, imkânsız, kapsam dışı ve madde atıfları; canlı bütçe; görünüm yalnız ilgili paragrafları taşır.
// Künyeler biçim örneğidir, gerçek karar değildir.
import type { McpResult, YargiMcpClient } from '@eda/ai/mcp';
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it } from 'vitest';
import { createAppSurface } from '../src/app.ts';
import { createReadiness } from '../src/health/ready.ts';
import { uuidv7 } from '../src/middleware/request-id.ts';
import { KunyeChecker } from '../src/services/kunye-check/kunye-check.ts';

const decision = (over: Record<string, unknown>) => ({
  source: 'bedesten',
  document_id: '100',
  court_type: 'yargitay',
  court: 'Yargıtay',
  chamber: '9. Hukuk Dairesi',
  chamber_code: 'H9',
  esas_no: '2024/1234',
  karar_no: '2025/5678',
  decision_date: '2025-03-12',
  title: 'Yargıtay 9. Hukuk Dairesi',
  snippet: null,
  url: 'https://mevzuat.adalet.gov.tr/ictihat/100',
  retrieved_at: '2026-10-10',
  origin: 'live',
  facets: null,
  ...over,
});

function fakeClient(calls: { name: string; args: Record<string, unknown> }[]): YargiMcpClient {
  return {
    async callTool(name, args): Promise<McpResult<unknown>> {
      calls.push({ name, args });
      if (name === 'get_legislation_live') {
        // yargi-mcp 034 §9.3 anahtarı: "G1", "E3", "M18"; eski "GEÇİCİ 1" biçimi yok.
        const key = String(args.article_no);
        const found = ['352', 'G1', 'E3', 'M18', '49/A'].includes(key);
        return {
          ok: true,
          value: {
            law_no: '6098',
            law_type: 'kanun',
            law_name: 'Türk Borçlar Kanunu',
            mevzuat_ref: '1.5.6098',
            url: 'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6098&MevzuatTur=1&MevzuatTertip=5',
            retrieved_at: '2026-10-10',
            last_amended_at: null,
            articles: found
              ? [{ article_no: key, heading: null, markdown: 'Madde metni.', repealed: false }]
              : [],
            total_chars: found ? 12 : 0,
            cached: false,
            warnings: found ? [] : ['article_not_found'],
          },
        };
      }
      const esas = args.esas_no;
      const results =
        esas === '2024/1234'
          ? [decision({})]
          : esas === '2023/77'
            ? [
                decision({
                  esas_no: '2023/77',
                  karar_no: '2023/90',
                  chamber_code: 'H3',
                  chamber: '3. Hukuk Dairesi',
                }),
              ]
            : [];
      return {
        ok: true,
        value: {
          source: 'bedesten',
          page: 1,
          page_size: 10,
          total: results.length,
          has_more: false,
          results,
          status: 'ok',
          cached: false,
          stale_as_of: null,
          warnings: [],
        },
      };
    },
    async listToolNames() {
      return [];
    },
    async close() {},
  };
}

async function run(text: string) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const checker = new KunyeChecker(async () => fakeClient(calls));
  const id = '01990000-0000-7000-8000-0000000000aa';
  checker.start(id, 'dev', text, '2026-10-10', () => new Date('2026-10-10T09:00:00Z'));
  for (let i = 0; i < 50; i++) {
    const v = checker.get(id, 'dev');
    if (v?.status === 'completed' || v?.status === 'failed') return { view: v, calls, checker };
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('iş bitmedi');
}

const DOC = [
  'İSTANBUL 3. ASLİYE HUKUK MAHKEMESİNE',
  'Dosya no: 2026/12 Esas',
  'Açıklama metni. '.repeat(60),
  'Kiracının tahliye taahhüdü geçerlidir (Yargıtay 9. Hukuk Dairesi, E. 2024/1234, K. 2025/5678, T. 12.03.2025). Ayrıca TBK m. 352 ve TBK m. 999.',
  'Aynı yönde Yargıtay 3. HD 2023/77 E., 2023/91 K. kararı ile Yargıtay 9. HD 2024/1234 E. de vardır.',
  'Başka bir paragraf.',
  'Ayrıca Yargıtay 31. Hukuk Dairesi, E. 2020/1, K. 2021/2 ve Kamu İhale Kurulunun 2021/UH.II-1234 sayılı kararı.',
].join('\n\n');

describe('P13.12: Künye Kontrolü işi', () => {
  it('künyeleri tekilleştirir, durumları atar, yalnız ilgili paragrafları döner', async () => {
    const { view, calls } = await run(DOC);
    expect(view.status).toBe('completed');
    const by = (raw: string) => view.results.find((r) => r.raw.includes(raw));

    const verified = by('E. 2024/1234');
    expect(verified).toMatchObject({ status: 'verified', kind: 'decision', source: 'bedesten' });
    expect(verified?.kunye).toBe(
      'Yargıtay 9. Hukuk Dairesi, E. 2024/1234, K. 2025/5678, T. 12.03.2025',
    );
    // Kısa yazım aynı kanonik anahtarı taşımaz (karar/tarih yok) ama aynı kayda doğrulanır.
    expect(by('9. HD 2024/1234')?.status).toBe('verified');

    const near = by('2023/77');
    expect(near).toMatchObject({ status: 'not_found', reason: 'near_miss' });
    expect(near?.nearMiss?.diffs).toEqual(['karar']);

    expect(by('31. Hukuk')).toMatchObject({ status: 'not_found', reason: 'impossible' });
    expect(by('Kamu İhale')).toMatchObject({ status: 'out_of_coverage', kind: 'authority' });
    expect(by('TBK m. 352')).toMatchObject({
      status: 'verified',
      kind: 'article',
      href: '/mevzuat/6098/352',
    });
    expect(by('TBK m. 999')).toMatchObject({ status: 'not_found', kind: 'article' });

    // İmkânsız ve kapsam dışı künye kaynağa gönderilmez; kendi dosya numarası künye sayılmaz.
    expect(calls.some((c) => c.args.esas_no === '2020/1')).toBe(false);
    expect(calls.some((c) => c.args.esas_no === '2026/12')).toBe(false);
    expect(calls.every((c) => c.name !== 'search_decisions' || c.args.source === 'bedesten')).toBe(
      true,
    );

    expect(view.paragraphs.map((p) => p.no)).toEqual([2, 3, 4, 5, 6]);
    expect(view.summary).toMatchObject({ distinct: view.results.length });
    expect(view.summary.verified + view.summary.attention).toBe(view.results.length);
  });

  it('AS-0349 regresyon: geçici/ek/mükerrer/harfli madde atfı MCP anahtarıyla sorgulanır', async () => {
    const { view, calls } = await run(
      'Bkz. TBK geçici m. 1, ayrıca TBK ek m. 3. Öte yandan TBK mükerrer m. 18 ve TBK m. 49/a.',
    );
    expect(view.status).toBe('completed');
    const asked = calls
      .filter((c) => c.name === 'get_legislation_live')
      .map((c) => c.args.article_no);
    expect(asked).toEqual(expect.arrayContaining(['G1', 'E3', 'M18', '49/A']));
    expect(asked.some((a) => /GEÇİCİ|EK /u.test(String(a)))).toBe(false);
    const by = (raw: string) => view.results.find((r) => r.raw.includes(raw));
    expect(by('geçici m. 1')).toMatchObject({
      status: 'verified',
      kunye: 'TBK geçici m. 1',
      href: '/mevzuat/6098/G1',
    });
    expect(by('ek m. 3')).toMatchObject({ status: 'verified', href: '/mevzuat/6098/E3' });
    expect(by('mükerrer m. 18')).toMatchObject({ status: 'verified', href: '/mevzuat/6098/M18' });
    expect(by('m. 49/a')).toMatchObject({ status: 'verified', href: '/mevzuat/6098/49-A' });
  });

  it('başka sahibin işi görünmez', async () => {
    const { checker } = await run('Yargıtay 9. Hukuk Dairesi, E. 2024/1234, K. 2025/5678');
    expect(checker.get('01990000-0000-7000-8000-0000000000aa', 'baska')).toBeNull();
  });
});

describe('P13.12: Künye Kontrolü uçları', () => {
  const app = createAppSurface({
    surface: 'app',
    logger: createLogger({ service: 'eda-api', level: 'error' }),
    state: { draining: false },
    maintenanceMode: () => false,
    jsonBodyMaxBytes: 1024,
    ready: createReadiness({ probes: [], cacheMs: 0, version: 't', state: { draining: false } }),
    kunyeChecks: {
      checker: new KunyeChecker(async () => fakeClient([])),
      uuid: () => uuidv7(),
      now: () => new Date('2026-10-10T09:00:00Z'),
    },
  }).app;
  const post = (body: FormData | string, key: string | null, type?: string) =>
    app.request('/api/v1/kunye-checks', {
      method: 'POST',
      body,
      headers: {
        ...(key ? { 'idempotency-key': key } : {}),
        ...(type ? { 'content-type': type } : {}),
      },
    });
  const form = (text: string) => {
    const f = new FormData();
    f.set('text', text);
    return f;
  };

  it('çok parçalı metin 202 + checkId; aynı anahtar aynı işi döner; görünüm no-store', async () => {
    const key = uuidv7();
    const text = 'Yargıtay 9. Hukuk Dairesi, E. 2024/1234, K. 2025/5678, T. 12.03.2025';
    const a = await post(form(text), key);
    expect(a.status).toBe(202);
    const { checkId } = (await a.json()) as { checkId: string };
    const b = await post(form(text), key);
    expect(((await b.json()) as { checkId: string }).checkId).toBe(checkId);
    await new Promise((r) => setTimeout(r, 30));
    const view = await app.request(`/api/v1/kunye-checks/${checkId}`);
    expect(view.status).toBe(200);
    expect(view.headers.get('cache-control')).toContain('no-store');
    expect(((await view.json()) as { status: string }).status).toBe('completed');
  });

  it('anahtarsız, kısa metin, JSON gövde ve bilinmeyen iş reddedilir; rapor portu bağlı değil', async () => {
    expect((await post(form('Yargıtay 9. HD 2024/1234 E. kontrol metni'), null)).status).toBe(422);
    expect((await post(form('kısa'), uuidv7())).status).toBe(422);
    expect((await post('{"text":"x"}', uuidv7(), 'application/json')).status).toBe(415);
    expect((await app.request(`/api/v1/kunye-checks/${uuidv7()}`)).status).toBe(404);
    expect((await app.request(`/api/v1/kunye-checks/${uuidv7()}/report`)).status).toBe(503);
  });
});

describe('025 §5.9: yoğunlukta yeniden deneme', () => {
  it('SOURCE_BUSY önerilen süre beklenip yeniden denenir; kalıcı hata denenmez', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const inner = fakeClient(calls);
    let busy = 1;
    const client: YargiMcpClient = {
      ...inner,
      async callTool(name, args, opts) {
        if (busy-- > 0) {
          return {
            ok: false,
            error: {
              code: 'SOURCE_BUSY',
              reason: 'queue_wait_exceeded',
              retry_after_ms: 1500,
              source: 'bedesten',
              origin: 'tool',
            },
          };
        }
        return inner.callTool(name, args, opts);
      },
    };
    const waits: number[] = [];
    const checker = new KunyeChecker(async () => client, {
      sleep: async (ms) => void waits.push(ms),
    });
    const id = '01990000-0000-7000-8000-0000000000bb';
    checker.start(
      id,
      'dev',
      'Yargıtay 9. Hukuk Dairesi, E. 2024/1234, K. 2025/5678',
      '2026-10-10',
      () => new Date(),
    );
    for (let i = 0; i < 50 && checker.get(id, 'dev')?.status !== 'completed'; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(waits).toEqual([1500]);
    expect(checker.get(id, 'dev')?.results[0]?.status).toBe('verified');
  });
});
