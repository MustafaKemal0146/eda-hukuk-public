// @tk TK-04 TK-05
// P09 kalıcılık kabul testleri (gerçek PostgreSQL; `eda_app` kiracı çalıştırıcısı, RLS açık).
//  KK-P09-1 oluştur/listele/yükle   KK-P09-2 tur kaydı: mesajlar, llm_parts, kaynaklar
//  KK-P09-3 sahiplik izolasyonu     KK-P09-4 büro izolasyonu    KK-P09-5 boş sohbet listelenmez
//  KK-P12-7 `[K#]` etiketi DB'de kalıcıdır: eski etiket korunur, yeni kaynak sıradakini alır
import { randomUUID } from 'node:crypto';
import type { SourceRecord } from '@eda/ai';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { restoreRefs } from '../../src/chat/turn.ts';
import { PgChatPersistence } from '../../src/services/chat/pg-persistence.ts';

let db: TestingDb;
let chat: PgChatPersistence;
let runner: ReturnType<TestingDb['runner']>;
const w = {} as { orgA: string; orgB: string; a1: string; a2: string; b1: string };

const uid = () => {
  const t = Date.now().toString(16).padStart(12, '0');
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${randomUUID().slice(15, 18)}-8${randomUUID().slice(19, 22)}-${randomUUID().slice(24)}`;
};

const source = (n: number): SourceRecord => ({
  ref: `K${n}`,
  kind: 'legislation',
  sourceKey: `legislation:6098:${n}`,
  sourceId: `6098:${n}`,
  shortKunye: `TBK m. ${n}`,
  title: `TÜRK BORÇLAR KANUNU m. ${n}`,
  portal: 'mevzuat',
  retrievedAt: '2026-10-12',
  relevance: 'high',
  law: { lawNo: '6098', lawName: 'Türk Borçlar Kanunu', articleNo: String(n) },
  excerpt: `Madde ${n} metni (sentetik).`,
});

beforeAll(async () => {
  db = createTestingDb(inject('pg'));
  w.orgA = await db.auth.insertOrg('Örnek Büro A', 'firm');
  w.orgB = await db.auth.insertOrg('Örnek Büro B', 'firm');
  await db.auth.grantSeats(w.orgA, 5);
  await db.auth.grantSeats(w.orgB, 5);
  const mk = async (org: string, tag: string) => {
    const id = await db.auth.insertUser({
      name: `Örnek ${tag}`,
      email: `${tag}.${randomUUID().slice(0, 8)}@ornek.test`,
      emailVerified: true,
      verificationStatus: 'verified',
    });
    await db.auth.addMember(org, id, 'lawyer');
    return id;
  };
  w.a1 = await mk(w.orgA, 'a1');
  w.a2 = await mk(w.orgA, 'a2');
  w.b1 = await mk(w.orgB, 'b1');
  runner = db.runner('eda_app');
  chat = new PgChatPersistence(runner);
});

afterAll(async () => {
  await db.close();
});

describe('KK-P09-1/2: sohbet ve tur kalıcılığı', () => {
  it('oluşturur, tur kaydeder, yeniden yükler ve listeler', async () => {
    const actor = { orgId: w.orgA, userId: w.a1 };
    const id = uid();
    await chat.create(actor, id);
    // KK-P09-5: mesajsız sohbet listede görünmez
    expect((await chat.list(actor)).map((c) => c.id)).not.toContain(id);

    const userId = uid();
    const asstId = uid();
    await chat.saveTurn(actor, id, {
      title: 'Kira artışı hakkında soru',
      userMessage: {
        id: userId,
        role: 'user',
        parts: [{ type: 'text', text: 'Kira artış oranı nedir?' }],
        metadata: { mode: 'chat' },
      },
      assistantMessage: {
        id: asstId,
        role: 'assistant',
        parts: [{ type: 'text', text: 'TBK m. 344 uyarınca [K1].' }],
        metadata: { status: 'complete', providerId: 'mock', region: 'TR', modelLabel: 'm' },
      },
      assistantStatus: 'complete',
      llm: [
        { role: 'user', content: 'çerçeve' },
        { role: 'assistant', content: 'TBK m. 344 uyarınca [K1].' },
      ],
      newSources: [source(1)],
      alias: 'edai-flash',
      requestId: uid(),
    });

    const loaded = await chat.load(actor, id);
    expect(loaded?.title).toBe('Kira artışı hakkında soru');
    expect(loaded?.ui.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(loaded?.llm).toHaveLength(2);
    expect(loaded?.sources.map((s) => s.ref)).toEqual(['K1']);
    expect(loaded?.sources[0]?.excerpt).toContain('sentetik');
    expect((await chat.list(actor)).map((c) => c.id)).toContain(id);

    // İkinci tur: etiket devamı ve transkript birikimi
    await chat.saveTurn(actor, id, {
      title: null,
      userMessage: { id: uid(), role: 'user', parts: [{ type: 'text', text: 'Peki ya m. 345?' }] },
      assistantMessage: {
        id: uid(),
        role: 'assistant',
        parts: [{ type: 'text', text: 'TBK m. 345 [K2].' }],
        metadata: { status: 'complete' },
      },
      assistantStatus: 'complete',
      llm: [
        { role: 'user', content: 'çerçeve 2' },
        { role: 'assistant', content: 'TBK m. 345 [K2].' },
      ],
      newSources: [source(2)],
      alias: 'edai-flash',
      requestId: uid(),
    });
    const again = await chat.load(actor, id);
    expect(again?.ui).toHaveLength(4);
    expect(again?.llm).toHaveLength(4);
    expect(again?.sources.map((s) => s.ref)).toEqual(['K1', 'K2']);
    expect(again?.title).toBe('Kira artışı hakkında soru');
  });
});

describe('KK-P09-3/4: izolasyon (RLS)', () => {
  it('aynı büronun başka kullanıcısı ve başka büro sohbeti göremez', async () => {
    const owner = { orgId: w.orgA, userId: w.a1 };
    const id = uid();
    await chat.create(owner, id);
    await chat.saveTurn(owner, id, {
      title: 'Gizli sohbet',
      userMessage: { id: uid(), role: 'user', parts: [{ type: 'text', text: 'x' }] },
      assistantMessage: null,
      assistantStatus: 'stopped',
      llm: [],
      newSources: [],
      alias: 'edai-flash',
      requestId: uid(),
    });
    expect(await chat.load({ orgId: w.orgA, userId: w.a2 }, id)).toBeNull();
    expect(await chat.load({ orgId: w.orgB, userId: w.b1 }, id)).toBeNull();
    expect((await chat.list({ orgId: w.orgA, userId: w.a2 })).map((c) => c.id)).not.toContain(id);
  });
});

describe('sohbet silme (041 #23)', () => {
  const turn = (title: string) => ({
    title,
    userMessage: {
      id: uid(),
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'x' }],
    },
    assistantMessage: {
      id: uid(),
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: 'yanıt [K1]' }],
      metadata: { status: 'complete' },
    },
    assistantStatus: 'complete' as const,
    llm: [],
    newSources: [source(1)],
    alias: 'edai-flash' as const,
    requestId: uid(),
  });

  const count = (actor: { orgId: string; userId: string }, sql: string, id: string) =>
    runner.withTenant(actor, async (tx) => {
      const r = await tx.query(sql, [id]);
      return Number((r.rows[0] as Record<string, unknown>).n);
    });

  it('sahibi siler: sohbet, mesajlar ve kaynaklar gider; başkasının sohbeti etkilenmez', async () => {
    const actor = { orgId: w.orgA, userId: w.a1 };
    const id = uid();
    const other = uid();
    await chat.create(actor, id);
    await chat.saveTurn(actor, id, turn('Silinecek'));
    await chat.create(actor, other);
    await chat.saveTurn(actor, other, turn('Kalacak'));

    expect(await chat.remove(actor, id)).toBe('deleted');
    expect(await chat.load(actor, id)).toBeNull();
    expect((await chat.list(actor)).map((c) => c.id)).not.toContain(id);
    expect(
      await count(actor, 'SELECT count(*) AS n FROM app.messages WHERE conversation_id = $1', id),
    ).toBe(0);
    expect(
      await count(
        actor,
        'SELECT count(*) AS n FROM app.message_sources WHERE conversation_id = $1',
        id,
      ),
    ).toBe(0);
    // Diğer sohbet yerinde.
    expect((await chat.list(actor)).map((c) => c.id)).toContain(other);
    expect(await chat.remove(actor, id)).toBe('not_found');
  });

  it('başka kullanıcı ve başka büro silemez; sohbet yerinde kalır', async () => {
    const owner = { orgId: w.orgA, userId: w.a1 };
    const id = uid();
    await chat.create(owner, id);
    await chat.saveTurn(owner, id, turn('Korunan'));

    expect(await chat.remove({ orgId: w.orgA, userId: w.a2 }, id)).toBe('not_found');
    expect(await chat.remove({ orgId: w.orgB, userId: w.b1 }, id)).toBe('not_found');
    expect((await chat.load(owner, id))?.title).toBe('Korunan');
  });
});

/** Kaynak satırlarının bağlı olduğu mesaj: `[K#]` etiketi bir kez verilir, yeniden üretimde kaymaz. */
const sourceRows = async (
  actor: { orgId: string; userId: string },
  id: string,
): Promise<{ ref_no: number; message_id: string | null }[]> =>
  runner.withTenant(actor, async (tx) => {
    const r = await tx.query(
      `SELECT ref_no, message_id FROM app.message_sources
        WHERE conversation_id = $1 ORDER BY ref_no`,
      [id],
    );
    return r.rows.map((x) => {
      const row = x as Record<string, unknown>;
      return {
        ref_no: Number(row.ref_no),
        message_id: typeof row.message_id === 'string' ? row.message_id : null,
      };
    });
  });

describe('KK-P12-7: `[K#]` etiketi sohbetin DB kaydıdır (025 §4.1)', () => {
  it('etiketler satır sırasından değil numaradan gelir; sonraki tur sıradaki numarayı alır', async () => {
    const actor = { orgId: w.orgA, userId: w.a1 };
    const id = uid();
    await chat.create(actor, id);
    // İlk tur: K1 ve K3 yazılır (K2 boşluk). Etiket, satır sırası değil kaydın kendisidir.
    await chat.saveTurn(actor, id, {
      title: 'Etiket deposu',
      userMessage: { id: uid(), role: 'user', parts: [{ type: 'text', text: 'Kira artışı?' }] },
      assistantMessage: {
        id: uid(),
        role: 'assistant',
        parts: [{ type: 'text', text: 'TBK m. 1 [K1], m. 3 [K3].' }],
        metadata: { status: 'complete', providerId: 'mock', region: 'TR' },
      },
      assistantStatus: 'complete',
      llm: [
        { role: 'user', content: 'çerçeve' },
        { role: 'assistant', content: 'TBK m. 1 [K1], m. 3 [K3].' },
      ],
      newSources: [source(1), source(3)],
      alias: 'edai-flash',
      requestId: uid(),
    });
    const loaded = await chat.load(actor, id);
    expect(loaded?.sources.map((s) => s.ref)).toEqual(['K1', 'K3']);
    expect(await sourceRows(actor, id)).toEqual([
      { ref_no: 1, message_id: expect.any(String) },
      { ref_no: 3, message_id: expect.any(String) },
    ]);

    // İkinci turun etiketleri `runTurn` ile AYNI yoldan geri yüklenir.
    const refs = restoreRefs(loaded?.sources ?? []);
    const reused = refs.allocate(source(3).sourceKey, (ref) => ({ ...source(3), ref }));
    expect(reused.ref).toBe('K3');
    const fresh = refs.allocate(source(4).sourceKey, (ref) => ({ ...source(4), ref }));
    // Eski davranış etiketi yalnız sayaçtan türetirdi: sayaç yüklenen kaynak SAYISINI izler, boşluğu
    // görmez; burada `K3` verip mevcut `[K3]` etiketini başka kaynağa kaydırırdı.
    expect(fresh.ref).toBe('K4');
    expect(refs.all().map((r) => r.ref)).toEqual(['K1', 'K3', 'K4']);

    await chat.saveTurn(actor, id, {
      title: null,
      userMessage: { id: uid(), role: 'user', parts: [{ type: 'text', text: 'Peki ya m. 4?' }] },
      assistantMessage: {
        id: uid(),
        role: 'assistant',
        parts: [{ type: 'text', text: 'TBK m. 4 [K4].' }],
        metadata: { status: 'complete', providerId: 'mock', region: 'TR' },
      },
      assistantStatus: 'complete',
      llm: [
        { role: 'user', content: 'çerçeve 2' },
        { role: 'assistant', content: 'TBK m. 4 [K4].' },
      ],
      newSources: [fresh],
      alias: 'edai-flash',
      requestId: uid(),
    });
    const after = await chat.load(actor, id);
    // Eski etiketler korunur, yeni kaynak sıradaki numarayı alır; kaynak yeniden yazılmaz.
    expect(after?.sources.map((s) => s.ref)).toEqual(['K1', 'K3', 'K4']);
    expect(after?.sources[0]?.sourceKey).toBe(source(1).sourceKey);
    expect(after?.sources[2]?.sourceKey).toBe(source(4).sourceKey);
    expect((await sourceRows(actor, id)).map((r) => r.ref_no)).toEqual([1, 3, 4]);
  });
});

describe('KK-P09-7: mesaj düzenleme (kes ve yeniden gönder)', () => {
  const turnOf = (userId: string, assistantId: string, n: number) => ({
    title: n === 1 ? 'Düzenleme sohbeti' : null,
    userMessage: {
      id: userId,
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: `soru ${n}` }],
    },
    assistantMessage: {
      id: assistantId,
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: `yanıt ${n} [K${n}]` }],
      metadata: { status: 'complete' },
    },
    assistantStatus: 'complete' as const,
    llm: [
      { role: 'user' as const, content: `çerçeve ${n}` },
      { role: 'assistant' as const, content: `yanıt ${n} [K${n}]` },
    ],
    newSources: [source(n)],
    alias: 'edai-flash' as const,
    requestId: uid(),
  });

  const transcriptFlags = (actor: { orgId: string; userId: string }, id: string) =>
    runner.withTenant(actor, async (tx) => {
      const r = await tx.query(
        `SELECT id, in_transcript FROM app.messages WHERE conversation_id = $1 ORDER BY created_at, id`,
        [id],
      );
      return r.rows.map((x) => {
        const row = x as Record<string, unknown>;
        return { id: String(row.id), inTranscript: row.in_transcript === true };
      });
    });

  it('hedef ve sonrası transkriptten düşer (satır silinmez), yeni tur peşine yazılır, etiketler korunur', async () => {
    const actor = { orgId: w.orgA, userId: w.a1 };
    const id = uid();
    await chat.create(actor, id);
    const u1 = uid();
    const a1 = uid();
    const u2 = uid();
    const a2 = uid();
    await chat.saveTurn(actor, id, turnOf(u1, a1, 1));
    await chat.saveTurn(actor, id, turnOf(u2, a2, 2));
    const before = await chat.load(actor, id);
    expect(before?.ui.map((m) => m.id)).toEqual([u1, a1, u2, a2]);
    expect(before?.llmCounts.get(a1)).toBe(2);
    expect(before?.llmCounts.get(a2)).toBe(2);

    const u3 = uid();
    const a3 = uid();
    await chat.saveTurn(actor, id, { ...turnOf(u3, a3, 3), replaceFromMessageId: u2 });
    const after = await chat.load(actor, id);
    // İkinci tur transkriptte değildir; yeni tur ilk turun peşindedir; transkript yinelenmez.
    expect(after?.ui.map((m) => m.id)).toEqual([u1, a1, u3, a3]);
    expect(after?.llm.map((m) => m.content)).toEqual([
      'çerçeve 1',
      'yanıt 1 [K1]',
      'çerçeve 3',
      'yanıt 3 [K3]',
    ]);
    expect(after?.lastAssistant).toEqual({ messageId: a3, llmCount: 2 });
    // Satırlar silinmez: kesilenler `in_transcript = false`.
    expect(await transcriptFlags(actor, id)).toEqual([
      { id: u1, inTranscript: true },
      { id: a1, inTranscript: true },
      { id: u2, inTranscript: false },
      { id: a2, inTranscript: false },
      { id: u3, inTranscript: true },
      { id: a3, inTranscript: true },
    ]);
    // `[K#]` bir kez verilir: kesilen yanıtın etiketi defterde kalır, yeni kaynak sıradakini alır.
    expect(after?.sources.map((s) => s.ref)).toEqual(['K1', 'K2', 'K3']);
    expect(after?.title).toBe('Düzenleme sohbeti');
  });

  it('başka kullanıcı veya büro kesemez; kesme noktası sohbet dışıysa hiçbir satır düşmez', async () => {
    const owner = { orgId: w.orgA, userId: w.a1 };
    const id = uid();
    await chat.create(owner, id);
    const u1 = uid();
    const a1 = uid();
    await chat.saveTurn(owner, id, turnOf(u1, a1, 1));

    // Aynı büronun başka kullanıcısı ve başka büro: sohbet görünmez, kayıt yazılmaz.
    await chat.saveTurn({ orgId: w.orgA, userId: w.a2 }, id, {
      ...turnOf(uid(), uid(), 2),
      replaceFromMessageId: u1,
    });
    await chat.saveTurn({ orgId: w.orgB, userId: w.b1 }, id, {
      ...turnOf(uid(), uid(), 2),
      replaceFromMessageId: u1,
    });
    expect((await chat.load(owner, id))?.ui.map((m) => m.id)).toEqual([u1, a1]);
    expect(await transcriptFlags(owner, id)).toEqual([
      { id: u1, inTranscript: true },
      { id: a1, inTranscript: true },
    ]);

    // Sahibinin başka sohbetindeki mesaj bu sohbette kesme noktası olamaz.
    const other = uid();
    const ou = uid();
    await chat.create(owner, other);
    await chat.saveTurn(owner, other, turnOf(ou, uid(), 1));
    const u2 = uid();
    const a2 = uid();
    await chat.saveTurn(owner, id, { ...turnOf(u2, a2, 2), replaceFromMessageId: ou });
    expect((await chat.load(owner, id))?.ui.map((m) => m.id)).toEqual([u1, a1, u2, a2]);
    expect((await chat.load(owner, other))?.ui).toHaveLength(2);
  });
});

describe('KK-P09-6: yeniden üretim (022 §2.1)', () => {
  it('son yanıtı yerinde günceller: kullanıcı mesajı, kimlik ve [K#] etiketi korunur', async () => {
    const actor = { orgId: w.orgA, userId: w.a1 };
    const id = uid();
    await chat.create(actor, id);
    const userId = uid();
    const src = source(1);
    const assistantId = uid();

    await chat.saveTurn(actor, id, {
      title: 'Yeniden üretim',
      userMessage: { id: userId, role: 'user', parts: [{ type: 'text', text: 'Kira artışı?' }] },
      assistantMessage: {
        id: assistantId,
        role: 'assistant',
        parts: [{ type: 'text', text: 'İlk yanıt [K1].' }],
        metadata: { status: 'complete', providerId: 'mock', region: 'TR' },
      },
      assistantStatus: 'complete',
      llm: [
        { role: 'user', content: 'çerçeve' },
        { role: 'assistant', content: 'İlk yanıt [K1].' },
      ],
      newSources: [src],
      alias: 'edai-flash',
      requestId: uid(),
    });

    const before = await chat.load(actor, id);
    expect(before?.lastAssistant).toEqual({ messageId: assistantId, llmCount: 2 });

    await chat.replaceTurn(actor, id, assistantId, {
      assistantMessage: {
        id: assistantId,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Yeni yanıt [K1].' }],
        metadata: { status: 'complete', providerId: 'mock', region: 'TR' },
      },
      assistantStatus: 'complete',
      llm: [
        { role: 'user', content: 'çerçeve' },
        { role: 'assistant', content: 'Yeni yanıt [K1].' },
      ],
      newSources: [],
      alias: 'edai-pro',
      requestId: uid(),
    });

    const after = await chat.load(actor, id);
    // Yerinde güncelleme: kullanıcı mesajı ve yanıt kimliği aynıdır, transkript yinelenmez.
    expect(after?.ui.map((m) => m.id)).toEqual([userId, assistantId]);
    expect(after?.ui.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(after?.ui[1]?.parts).toEqual([{ type: 'text', text: 'Yeni yanıt [K1].' }]);
    expect(after?.llm.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(after?.llm[1]).toMatchObject({ content: 'Yeni yanıt [K1].' });
    // `[K#]` bir kez verilir: etiket ve kaynak bağı değişmez.
    expect(after?.sources.map((s) => s.ref)).toEqual(['K1']);
    expect(after?.lastAssistant).toEqual({ messageId: assistantId, llmCount: 2 });
    expect(await sourceRows(actor, id)).toEqual([{ ref_no: 1, message_id: assistantId }]);
    expect(after?.title).toBe('Yeniden üretim');
  });

  it('yeniden üretimde yeni kaynak sıradaki etiketi alır ve aynı yanıta bağlanır', async () => {
    const actor = { orgId: w.orgA, userId: w.a1 };
    const id = uid();
    await chat.create(actor, id);
    const userId = uid();
    const assistantId = uid();

    await chat.saveTurn(actor, id, {
      title: null,
      userMessage: { id: userId, role: 'user', parts: [{ type: 'text', text: 'Kira artışı?' }] },
      assistantMessage: {
        id: assistantId,
        role: 'assistant',
        parts: [{ type: 'text', text: 'İlk yanıt [K1].' }],
        metadata: { status: 'complete' },
      },
      assistantStatus: 'complete',
      llm: [
        { role: 'user', content: 'çerçeve' },
        { role: 'assistant', content: 'İlk yanıt [K1].' },
      ],
      newSources: [source(1)],
      alias: 'edai-flash',
      requestId: uid(),
    });

    await chat.replaceTurn(actor, id, assistantId, {
      assistantMessage: {
        id: assistantId,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Yeni yanıt [K1][K2].' }],
        metadata: { status: 'complete' },
      },
      assistantStatus: 'complete',
      llm: [
        { role: 'user', content: 'çerçeve' },
        { role: 'assistant', content: 'Yeni yanıt [K1][K2].' },
      ],
      newSources: [source(2)],
      alias: 'edai-flash',
      requestId: uid(),
    });

    const after = await chat.load(actor, id);
    // Eski etiket korunur, yeni kaynak sıradaki numarayı alır ve aynı yanıta bağlanır.
    expect(after?.sources.map((s) => s.ref)).toEqual(['K1', 'K2']);
    expect(await sourceRows(actor, id)).toEqual([
      { ref_no: 1, message_id: assistantId },
      { ref_no: 2, message_id: assistantId },
    ]);
    // Transkript yinelenmez: tek kullanıcı + tek yanıt.
    expect(after?.ui).toHaveLength(2);
    expect(after?.llm).toHaveLength(2);
  });
});
