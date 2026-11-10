// Künye Kontrolü (025 §14, P13.12) geliştirme dilimi: Postgres, worker ve dosya alım portu gelene dek iş
// süreç içinde koşar ve sonuç bellekte tutulur. Akış: paragraflara böl → `extractAll`
// (`report` kipi, header_zone dahil) → kanonik anahtarla tekilleştir → imkânsız/kapsam dışı ayıkla →
// canlı doğrulama (`verify` önceliği; çalışma başına ≤ 40 canlı sorgu) → görünüm. Yapay zekâ kullanılmaz.
// Log'a künye, alıntı veya metin yazılmaz; yalnız sayılar.
import {
  getLegislationLive,
  type McpCallError,
  type McpResult,
  searchDecisionsLive,
} from '@eda/ai/mcp';
import type { KunyeCheckResult, KunyeCheckViewDto } from '@eda/contracts/api/kunye-checks';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { KunyeStatus } from '@eda/contracts/enums';
import type { NormalizedDecisionValue } from '@eda/contracts/mcp';
import type { CourtType } from '@eda/contracts/tools';
import {
  type CourtClass,
  extractAll,
  formatArticleRef,
  formatKunye,
  type KunyeRecord,
  OUT_OF_COVERAGE_CLASSES,
  type ParsedCitation,
  type ParsedKunye,
  parseCaseNo,
} from '@eda/legal/kunye';
import { tr_upper } from '@eda/legal/text';
import type { McpClientProvider } from '../../clients/yargi-mcp.ts';

const MAX_ITEMS = CONFIG_DEFAULTS['citations.checkMaxItems'];
const MAX_LIVE = CONFIG_DEFAULTS['citations.checkMaxLiveLookups'];
const HEADER_ZONE = CONFIG_DEFAULTS['citations.headerZoneChars'];
const PRIORITY = 'verify' as const;
/** `verify` sınıfı kovada beklemez; yoğunlukta iş `retry_after_ms` ile yeniden denenir (025 §5.9). */
const BUSY_ATTEMPTS = CONFIG_DEFAULTS['citations.reverifyMaxAttempts'];
const BUSY_WAIT_DEFAULT_MS = CONFIG_DEFAULTS['sources.bedesten.tokenIntervalMs'];
const BUSY_WAIT_MAX_MS = CONFIG_DEFAULTS['sources.retryAfterMaxSec'] * 1000;

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

type LiveSource = 'bedesten' | 'anayasa' | 'uyusmazlik';

/** 025 §5.9 tablosu: ayrıştırıcı sınıfı → canlı kaynak ve MCP mahkeme türü. */
const LIVE: Partial<Record<CourtClass, { source: LiveSource; courtType: CourtType }>> = {
  yargitay: { source: 'bedesten', courtType: 'yargitay' },
  danistay: { source: 'bedesten', courtType: 'danistay' },
  kyb: { source: 'bedesten', courtType: 'kyb' },
  istinaf_hukuk: { source: 'bedesten', courtType: 'istinaf_hukuk' },
  yerel: { source: 'bedesten', courtType: 'ilk_derece_hukuk' },
  aym_norm: { source: 'anayasa', courtType: 'aym_norm' },
  aym_bireysel: { source: 'anayasa', courtType: 'aym_bireysel' },
  uyusmazlik: { source: 'uyusmazlik', courtType: 'uyusmazlik' },
};

type Lookup = {
  status: KunyeStatus;
  reason: KunyeCheckResult['reason'];
  kunye: string | null;
  nearMiss: KunyeCheckResult['nearMiss'];
  source: KunyeCheckResult['source'];
  url: string | null;
  href: string | null;
};

type Item = {
  key: string;
  citation: ParsedCitation;
  occurrences: KunyeCheckResult['occurrences'];
};

export type KunyeCheckJob = {
  view: KunyeCheckViewDto;
  ownerKey: string;
};

const sameNo = (a: string | null, b: string | null): boolean => {
  if (a === null || b === null) return false;
  const x = parseCaseNo(a);
  const y = parseCaseNo(b);
  if (!x || !y) return a === b;
  return (
    x.year === y.year &&
    x.seq === y.seq &&
    (x.group === null || y.group === null || x.group === y.group)
  );
};

function recordOf(d: NormalizedDecisionValue, cls: CourtClass): KunyeRecord {
  return {
    courtClass: cls,
    courtName: d.court,
    chamberCode: d.chamber_code,
    chamberName: d.chamber_code ? null : d.chamber,
    chamberShort: null,
    esasNo: d.esas_no,
    kararNo: d.karar_no,
    decisionDate: d.decision_date,
    unitLabel: null,
    rgText: null,
  };
}

function keyOf(c: ParsedCitation): string {
  if (c.article) {
    return `m:${c.article.lawNo ?? c.article.abbr}:${c.article.articles.map((a) => `${a.key}/${a.paragraph ?? ''}${a.sub ?? ''}`).join(',')}`;
  }
  const k = c.kunye as ParsedKunye;
  return [
    k.courtClass,
    k.chamberCode,
    k.esas?.canon,
    k.karar?.canon,
    k.basvuruNo?.canon,
    k.date,
    k.authorityNo,
  ].join('|');
}

/**
 * yargi-mcp `article_no` adayları (034 §9.3 anahtarı: 352, 352/A, G5, E3, M18). Tek harfli alt
 * bent harfli madde de olabilir ("m. 49/a"): önce harfli madde (49/A), bulunamazsa madde (49) denenir.
 * Mükerrer maddede harf yoktur.
 */
function mcpArticleNo(key: string, sub: string | null): string[] {
  if (key.startsWith('M')) return [key];
  return sub && /^\p{L}$/u.test(sub) ? [`${key}/${tr_upper(sub)}`, key] : [key];
}

const unavailable = (source: Lookup['source'], reason: Lookup['reason']): Lookup => ({
  status: 'source_unavailable',
  reason,
  kunye: null,
  nearMiss: null,
  source,
  url: null,
  href: null,
});

function errorLookup(err: McpCallError, source: Lookup['source']): Lookup {
  if (err.code === 'SOURCE_NOT_IN_COVERAGE') {
    return { ...unavailable(source, 'not_in_coverage'), status: 'out_of_coverage' };
  }
  return unavailable(source, 'source_error');
}

export class KunyeChecker {
  readonly #mcp: McpClientProvider;
  readonly #jobs = new Map<string, KunyeCheckJob>();
  readonly #maxJobs: number;
  readonly #sleep: Sleep;

  constructor(mcp: McpClientProvider, opts: { maxJobs?: number; sleep?: Sleep } = {}) {
    this.#mcp = mcp;
    this.#maxJobs = opts.maxJobs ?? 100;
    this.#sleep = opts.sleep ?? realSleep;
  }

  /** Yoğunluk/hız sınırında önerilen süre kadar bekleyip yeniden dener (deneme hakkı sınırlı). */
  async #retrying<T>(call: () => Promise<McpResult<T>>): Promise<McpResult<T>> {
    let res = await call();
    for (let i = 1; i < BUSY_ATTEMPTS && !res.ok; i++) {
      if (res.error.code !== 'SOURCE_BUSY' && res.error.code !== 'SOURCE_RATE_LIMITED') break;
      await this.#sleep(
        Math.min(res.error.retry_after_ms ?? BUSY_WAIT_DEFAULT_MS, BUSY_WAIT_MAX_MS),
      );
      res = await call();
    }
    return res;
  }

  get(checkId: string, ownerKey: string): KunyeCheckViewDto | null {
    const job = this.#jobs.get(checkId);
    return job && job.ownerKey === ownerKey ? job.view : null;
  }

  /** İşi kuyruğa alır ve hemen döner; çalışma arka planda sürer. */
  start(checkId: string, ownerKey: string, text: string, today: string, now: () => Date): void {
    if (this.#jobs.size >= this.#maxJobs) {
      const oldest = this.#jobs.keys().next().value;
      if (oldest !== undefined) this.#jobs.delete(oldest);
    }
    const view: KunyeCheckViewDto = {
      checkId,
      status: 'queued',
      summary: {
        distinct: 0,
        verified: 0,
        attention: 0,
        excluded: 0,
        notChecked: 0,
        progress: { done: 0, total: 0 },
      },
      results: [],
      paragraphs: [],
      createdAt: now().toISOString(),
      completedAt: null,
    };
    this.#jobs.set(checkId, { view, ownerKey });
    void this.#run(view, text, today, now).catch(() => {
      view.status = 'failed';
      view.completedAt = now().toISOString();
    });
  }

  async #run(view: KunyeCheckViewDto, text: string, today: string, now: () => Date): Promise<void> {
    view.status = 'running';
    const paragraphs = text
      .split(/\n\s*\n/u)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const items = new Map<string, Item>();
    const marked = new Set<number>();
    let offset = 0;
    let excluded = 0;
    paragraphs.forEach((p, no) => {
      const { citations, excluded: ex } = extractAll(p, {
        today,
        ...(offset < HEADER_ZONE ? { headerZoneChars: HEADER_ZONE - offset } : {}),
      });
      offset += p.length + 2;
      excluded += ex.length;
      for (const c of citations) {
        const key = keyOf(c);
        const occ = { paragraph: no, start: c.span.start, end: c.span.end };
        const item = items.get(key);
        if (item) item.occurrences.push(occ);
        else items.set(key, { key, citation: c, occurrences: [occ] });
        marked.add(no);
      }
    });
    const all = [...items.values()];
    const checked = all.slice(0, MAX_ITEMS);
    view.summary.distinct = all.length;
    view.summary.excluded = excluded;
    view.summary.notChecked = all.length - checked.length;
    view.summary.progress = { done: 0, total: checked.length };
    // Yalnız künye içeren paragraflar ve ±1 komşusu (P13.12).
    const keep = new Set<number>();
    for (const n of marked)
      for (const k of [n - 1, n, n + 1]) if (k >= 0 && k < paragraphs.length) keep.add(k);
    view.paragraphs = [...keep]
      .sort((a, b) => a - b)
      .map((no) => ({ no, text: paragraphs[no] ?? '' }));

    let live = 0;
    for (const item of checked) {
      const lookup = await this.#resolve(item.citation, () => live++ < MAX_LIVE);
      view.results.push({
        id: `r${view.results.length + 1}`,
        kind:
          item.citation.kind === 'article'
            ? 'article'
            : item.citation.kind === 'authority_other'
              ? 'authority'
              : 'decision',
        raw: item.citation.raw.slice(0, 300),
        ...lookup,
        occurrences: item.occurrences,
      });
      view.summary.progress.done += 1;
      if (lookup.status === 'verified') view.summary.verified += 1;
      else view.summary.attention += 1;
    }
    view.status = 'completed';
    view.completedAt = now().toISOString();
  }

  async #resolve(c: ParsedCitation, takeLive: () => boolean): Promise<Lookup> {
    if (c.impossible.length > 0) {
      return { ...unavailable(null, 'impossible'), status: 'not_found' };
    }
    if (c.article) return this.#resolveArticle(c, takeLive);
    const k = c.kunye as ParsedKunye;
    const target = LIVE[k.courtClass];
    if (OUT_OF_COVERAGE_CLASSES.has(k.courtClass) || !target) {
      return { ...unavailable(null, 'not_in_coverage'), status: 'out_of_coverage' };
    }
    if (!takeLive()) return unavailable(target.source, 'budget_exceeded');
    const client = await this.#mcp().catch(() => null);
    if (!client) return unavailable(target.source, 'source_error');
    const esas = k.esas ?? k.basvuruNo;
    const esasArg = esas && esas.group === null ? esas.canon : null;
    const kararArg = !esasArg && k.karar && k.karar.group === null ? k.karar.canon : null;
    if (!esasArg && !kararArg) return unavailable(target.source, 'source_error');
    const chamber =
      target.source === 'bedesten' && k.chamberCode && /^[A-Z]+\d*$/.test(k.chamberCode)
        ? k.chamberCode
        : null;
    const res = await this.#retrying(() =>
      searchDecisionsLive(
        client,
        {
          source: target.source,
          query: esasArg ?? kararArg ?? '',
          court_types: [target.courtType],
          chamber,
          date_from: null,
          date_to: null,
          esas_no: esasArg,
          karar_no: kararArg,
          page: 1,
          page_size: 10,
        },
        target.source === 'uyusmazlik'
          ? { priority: PRIORITY, timeoutMs: CONFIG_DEFAULTS['sources.mcpSlowSearchTimeoutMs'] }
          : { priority: PRIORITY },
      ),
    );
    if (!res.ok) return errorLookup(res.error, target.source);
    let near: {
      d: NormalizedDecisionValue;
      diffs: ('chamber' | 'esas' | 'karar' | 'date')[];
    } | null = null;
    for (const d of res.value.results) {
      const diffs: ('chamber' | 'esas' | 'karar' | 'date')[] = [];
      if (esas && !sameNo(esas.canon, d.esas_no)) diffs.push('esas');
      if (k.karar && !sameNo(k.karar.canon, d.karar_no)) diffs.push('karar');
      if (k.date && d.decision_date && k.date !== d.decision_date) diffs.push('date');
      if (chamber && d.chamber_code && chamber !== d.chamber_code) diffs.push('chamber');
      if (diffs.length === 0) {
        return {
          status: 'verified',
          reason: null,
          kunye: formatKunye(recordOf(d, k.courtClass), 'full').text,
          nearMiss: null,
          source: target.source,
          url: d.url,
          href: null,
        };
      }
      const anchor = !diffs.includes('esas') || !diffs.includes('karar');
      if (anchor && (near === null || diffs.length < near.diffs.length)) near = { d, diffs };
    }
    // Yokluk yalnız sorgu tamamlandıysa kanıtlıdır (025 §5.9.1); kesilmiş sonuç doğrulanamadı sayılır.
    if (res.value.has_more === true && res.value.results.length >= 10) {
      return unavailable(target.source, 'source_error');
    }
    return {
      status: 'not_found',
      reason: near ? 'near_miss' : null,
      kunye: null,
      nearMiss: near
        ? { kunye: formatKunye(recordOf(near.d, k.courtClass), 'full').text, diffs: near.diffs }
        : null,
      source: target.source,
      url: null,
      href: null,
    };
  }

  async #resolveArticle(c: ParsedCitation, takeLive: () => boolean): Promise<Lookup> {
    const a = c.article;
    const first = a?.articles[0];
    if (!a || !first || a.lawNo === null) {
      return { ...unavailable(null, 'not_in_coverage'), status: 'out_of_coverage' };
    }
    const label = formatArticleRef({ lawNo: a.lawNo, articles: [first], open: false });
    const lettered =
      first.sub &&
      /^\p{L}$/u.test(first.sub) &&
      first.paragraph === null &&
      !first.key.startsWith('M');
    const href = `/mevzuat/${a.lawNo}/${first.key}${lettered ? `-${tr_upper(first.sub ?? '')}` : ''}`;
    if (!takeLive()) return unavailable('mevzuat', 'budget_exceeded');
    const client = await this.#mcp().catch(() => null);
    if (!client) return unavailable('mevzuat', 'source_error');
    for (const articleNo of mcpArticleNo(first.key, first.paragraph === null ? first.sub : null)) {
      const res = await this.#retrying(() =>
        getLegislationLive(
          client,
          { law_no: a.lawNo as string, law_type: null, article_no: articleNo, article_to: null },
          { priority: PRIORITY },
        ),
      );
      if (res.ok && res.value.articles.length > 0) {
        return {
          status: res.value.articles[0]?.repealed ? 'out_of_context' : 'verified',
          reason: null,
          kunye: label,
          nearMiss: null,
          source: 'mevzuat',
          url: res.value.url,
          href,
        };
      }
      if (!res.ok && res.error.code !== 'SOURCE_DOCUMENT_NOT_FOUND') {
        return errorLookup(res.error, 'mevzuat');
      }
    }
    return {
      status: 'not_found',
      reason: null,
      kunye: label,
      nearMiss: null,
      source: 'mevzuat',
      url: null,
      href: null,
    };
  }
}
