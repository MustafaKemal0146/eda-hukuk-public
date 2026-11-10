// @tk TK-06
// KK-P20-2 (KK-033-9): büro anahtarlığı: DEK çözme, sürüm seçimi, önbellek (LRU/TTL), imha edilmiş
// anahtar ve KEK sürümü uyuşmazlığı fail-closed; her çağrı özel kopya döner.
import { randomBytes } from 'node:crypto';
import { AppError } from '@eda/contracts/errors';
import { generateFileKey, wrapDek } from '@eda/crypto';
import { describe, expect, it } from 'vitest';
import { createKeyring } from '../src/keyring.ts';
import type { TenantTx } from '../src/tenant.ts';

const ORG = '00000000-0000-7000-8000-00000000000a';
const KEK1 = randomBytes(32);
const KEK2 = randomBytes(32);

interface Row {
  org_id: string;
  key_version: number;
  kek_version: number;
  status: string;
  wrapped_dek: Buffer | null;
}

function fakeTx(rows: Row[]): { tx: TenantTx; queries: () => number } {
  let n = 0;
  const tx = {
    query: async (text: string, values: readonly unknown[] = []) => {
      n += 1;
      const org = values[0];
      const active = text.includes("status = 'active'");
      const found = rows
        .filter((r) => r.org_id === org)
        .filter((r) => (active ? r.status === 'active' : r.key_version === values[1]))
        .filter((r) => active || r.status !== 'shredded');
      found.sort((a, b) => b.key_version - a.key_version);
      return { rows: found.slice(0, 1) };
    },
  };
  return { tx: tx as unknown as TenantTx, queries: () => n };
}

function row(
  version: number,
  kekVersion: number,
  kek: Buffer,
  dek: Buffer,
  status = 'active',
): Row {
  return {
    org_id: ORG,
    key_version: version,
    kek_version: kekVersion,
    status,
    wrapped_dek: wrapDek(kek, { orgId: ORG, dekVersion: version, kekVersion }, dek),
  };
}

const code = (e: unknown): unknown => (e instanceof AppError ? e.code : null);

describe('KK-P20-2: büro anahtarlığı', () => {
  it('etkin DEK açılır; sürüm döner; çağıran kopyası sıfırlanınca önbellek bozulmaz', async () => {
    const dek = generateFileKey();
    const { tx } = fakeTx([row(1, 1, KEK1, dek)]);
    const ring = createKeyring({ keks: [{ kek: KEK1, kekVersion: 1 }] });
    const a = await ring.activeDek(tx, ORG);
    expect(a.keyVersion).toBe(1);
    expect(a.dek.equals(dek)).toBe(true);
    a.dek.fill(0);
    const b = await ring.activeDek(tx, ORG);
    expect(b.dek.equals(dek)).toBe(true);
  });

  it('döndürme sonrası eski sürüm sürümüyle açılır, etkin yeni sürümdür', async () => {
    const d1 = generateFileKey();
    const d2 = generateFileKey();
    const { tx } = fakeTx([row(1, 1, KEK1, d1, 'retiring'), row(2, 1, KEK1, d2)]);
    const ring = createKeyring({ keks: [{ kek: KEK1, kekVersion: 1 }] });
    expect((await ring.activeDek(tx, ORG)).keyVersion).toBe(2);
    expect((await ring.dekByVersion(tx, ORG, 1)).dek.equals(d1)).toBe(true);
  });

  it('KEK döndürmesinde org_keys.kek_version doğru KEK ile açılır', async () => {
    const dek = generateFileKey();
    const { tx } = fakeTx([row(1, 2, KEK2, dek)]);
    const ring = createKeyring({
      keks: [
        { kek: KEK2, kekVersion: 2 },
        { kek: KEK1, kekVersion: 1 },
      ],
    });
    expect((await ring.activeDek(tx, ORG)).dek.equals(dek)).toBe(true);
  });

  it('bilinmeyen KEK sürümü, imha edilmiş veya olmayan anahtar 503 storage (fail-closed)', async () => {
    const dek = generateFileKey();
    const ring = createKeyring({ keks: [{ kek: KEK1, kekVersion: 1 }] });
    const unknownKek = fakeTx([row(1, 7, KEK1, dek)]);
    await expect(ring.activeDek(unknownKek.tx, ORG)).rejects.toSatisfy(
      (e) => code(e) === 'INTERNAL_DEPENDENCY_UNAVAILABLE',
    );
    const shredded = fakeTx([row(1, 1, KEK1, dek, 'shredded')]);
    await expect(ring.dekByVersion(shredded.tx, ORG, 1)).rejects.toSatisfy(
      (e) => code(e) === 'INTERNAL_DEPENDENCY_UNAVAILABLE',
    );
    await expect(ring.activeDek(fakeTx([]).tx, ORG)).rejects.toSatisfy(
      (e) => code(e) === 'INTERNAL_DEPENDENCY_UNAVAILABLE',
    );
  });

  it('bozuk sarılı anahtar (yanlış KEK) 503 verir; mesajda anahtar yoktur', async () => {
    const dek = generateFileKey();
    const { tx } = fakeTx([row(1, 1, KEK2, dek)]);
    const ring = createKeyring({ keks: [{ kek: KEK1, kekVersion: 1 }] });
    const err = await ring.activeDek(tx, ORG).catch((e: unknown) => e);
    expect(code(err)).toBe('INTERNAL_DEPENDENCY_UNAVAILABLE');
    expect(String((err as Error).message)).not.toContain(KEK1.toString('hex'));
  });

  it('dekByVersion önbellekten DB sorgusuz döner; TTL dolunca yeniden okur', async () => {
    const dek = generateFileKey();
    const { tx, queries } = fakeTx([row(1, 1, KEK1, dek)]);
    let t = 1_000;
    const ring = createKeyring({
      keks: [{ kek: KEK1, kekVersion: 1 }],
      now: () => t,
      ttlMs: 300_000,
    });
    await ring.dekByVersion(tx, ORG, 1);
    expect(queries()).toBe(1);
    await ring.dekByVersion(tx, ORG, 1);
    expect(queries()).toBe(1);
    t += 300_001;
    await ring.dekByVersion(tx, ORG, 1);
    expect(queries()).toBe(2);
  });

  it('LRU: en çok maxOrgs girdi tutulur', async () => {
    const ring = createKeyring({ keks: [{ kek: KEK1, kekVersion: 1 }], maxOrgs: 2 });
    const orgs = ['a', 'b', 'c'].map((c) => `00000000-0000-7000-8000-00000000000${c}`);
    // org_id bağlamı AAD'dedir: satırları her büro için doğru sarmayla yeniden üret.
    const fixed = orgs.map((o) => ({
      org_id: o,
      key_version: 1,
      kek_version: 1,
      status: 'active',
      wrapped_dek: wrapDek(KEK1, { orgId: o, dekVersion: 1, kekVersion: 1 }, generateFileKey()),
    }));
    const { tx, queries } = fakeTx(fixed);
    for (const o of orgs) await ring.dekByVersion(tx, o, 1);
    expect(queries()).toBe(3);
    await ring.dekByVersion(tx, orgs[2] as string, 1);
    expect(queries()).toBe(3);
    await ring.dekByVersion(tx, orgs[0] as string, 1);
    expect(queries()).toBe(4);
    ring.clear();
    await ring.dekByVersion(tx, orgs[2] as string, 1);
    expect(queries()).toBe(5);
  });
});
