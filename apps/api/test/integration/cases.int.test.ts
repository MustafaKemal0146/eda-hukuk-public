// @tk TK-04 TK-05
// P20 ilk dilim: dava klasörleri (gerçek PostgreSQL; `eda_app`, RLS açık).
//  KK-P20-1 oluştur, oku, listele, ara   KK-P20-2 restricted görünürlük   KK-P20-3 büro izolasyonu
//  KK-P20-4 asistan dava açamaz          KK-P20-5 güncelleme ve imleç
import { randomUUID } from 'node:crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createCasesService } from '../../src/services/cases/cases.ts';

let db: TestingDb;
let svc: ReturnType<typeof createCasesService>;
const w = {} as { orgA: string; orgB: string; a1: string; a2: string; asst: string; b1: string };

beforeAll(async () => {
  db = createTestingDb(inject('pg'));
  w.orgA = await db.auth.insertOrg('Örnek Büro A', 'firm');
  w.orgB = await db.auth.insertOrg('Örnek Büro B', 'firm');
  await db.auth.grantSeats(w.orgA, 5);
  await db.auth.grantSeats(w.orgB, 5);
  const mk = async (org: string, tag: string, role: string) => {
    const id = await db.auth.insertUser({
      name: `Örnek ${tag}`,
      email: `${tag}.${randomUUID().slice(0, 8)}@ornek.test`,
      emailVerified: true,
      verificationStatus: 'verified',
    });
    await db.auth.addMember(org, id, role);
    return id;
  };
  w.a1 = await mk(w.orgA, 'd1', 'lawyer');
  w.a2 = await mk(w.orgA, 'd2', 'lawyer');
  w.asst = await mk(w.orgA, 'd3', 'assistant');
  w.b1 = await mk(w.orgB, 'd4', 'lawyer');
  svc = createCasesService({ db: db.runner('eda_app') });
});

afterAll(async () => {
  await db.close();
});

const A1 = () => ({ orgId: w.orgA, userId: w.a1, memberRole: 'lawyer' as const });
const A2 = () => ({ orgId: w.orgA, userId: w.a2, memberRole: 'lawyer' as const });

describe('KK-P20-1: dava klasörü', () => {
  it('oluşturur, okur ve Türkçe ön ekle arar', async () => {
    const c = await svc.create(A1(), {
      title: 'İşçilik Alacağı Davası',
      officeFileCode: 'BRO-2026-014',
      esasNo: '2026/1234',
      visibility: 'org',
    });
    expect(c.mine).toBe(true);
    expect(c.status).toBe('active');
    expect((await svc.get(A2(), c.id)).title).toBe('İşçilik Alacağı Davası');
    const hit = await svc.list(A2(), { q: 'işçi' });
    expect(hit.items.map((x) => x.id)).toContain(c.id);
    expect((await svc.list(A2(), { q: 'BRO-2026' })).items.map((x) => x.id)).toContain(c.id);
    expect((await svc.list(A2(), { q: 'kira' })).items.map((x) => x.id)).not.toContain(c.id);
  });
});

describe('KK-P20-2/3: görünürlük ve izolasyon', () => {
  it('restricted dava yalnız oluşturanca görünür; diğer büro göremez', async () => {
    const c = await svc.create(A1(), { title: 'Gizli Dosya', visibility: 'restricted' });
    expect((await svc.list(A1(), {})).items.map((x) => x.id)).toContain(c.id);
    expect((await svc.list(A2(), {})).items.map((x) => x.id)).not.toContain(c.id);
    await expect(svc.get(A2(), c.id)).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });
    await expect(
      svc.get({ orgId: w.orgB, userId: w.b1, memberRole: 'lawyer' }, c.id),
    ).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });
  });
});

describe('KK-P20-4/5: yetki, güncelleme, imleç', () => {
  it('asistan dava açamaz ama okuyabilir', async () => {
    const asst = { orgId: w.orgA, userId: w.asst, memberRole: 'assistant' as const };
    await expect(svc.create(asst, { title: 'Yetkisiz', visibility: 'org' })).rejects.toMatchObject({
      code: 'ORG_ROLE_INSUFFICIENT',
    });
    expect((await svc.list(asst, {})).items.length).toBeGreaterThan(0);
  });

  it('başlık ve durum güncellenir; imleçle sayfalanır', async () => {
    const c = await svc.create(A1(), { title: 'Kira Tespiti', visibility: 'org' });
    const p = await svc.patch(A1(), c.id, { title: 'Kira Bedeli Tespiti', status: 'on_hold' });
    expect(p.title).toBe('Kira Bedeli Tespiti');
    expect(p.status).toBe('on_hold');
    expect((await svc.list(A1(), { status: 'on_hold' })).items.map((x) => x.id)).toContain(c.id);
    for (let i = 0; i < 3; i++) await svc.create(A1(), { title: `Sayfa ${i}`, visibility: 'org' });
    const first = await svc.list(A1(), { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await svc.list(A1(), { limit: 2, cursor: first.nextCursor as string });
    expect(second.items.some((x) => first.items.some((y) => y.id === x.id))).toBe(false);
  });
});
