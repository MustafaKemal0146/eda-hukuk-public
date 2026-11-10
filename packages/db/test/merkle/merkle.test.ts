// @tk TK-26
// KK-P03c-16: audit.seal Merkle sabit vektörleri (043 §10.2). Beklenen özetler uygulamadan
// bağımsız olarak (Python hashlib + json.dumps(sort_keys, ensure_ascii=False)) hesaplanmıştır.
import { describe, expect, it } from 'vitest';
import {
  type AuditLeafRow,
  canonicalJson,
  leafHash,
  merkleRoot,
  sealHash,
} from '../../src/audit/merkle.ts';

const META = { b: 1, a: [2, { d: null, c: 'ç' }] };
const ROWS: AuditLeafRow[] = [
  {
    id: '00000000-0000-7000-8000-000000000001',
    created_at: '2026-10-11T10:00:00.000001Z',
    org_id: null,
    actor_type: 'system',
    actor_id: null,
    action: 'org.settings.changed',
    target_type: 'org_settings',
    target_id: 'x',
    metadata: META,
  },
  {
    id: '00000000-0000-7000-8000-000000000002',
    created_at: '2026-10-11T10:00:30.500000Z',
    org_id: '00000000-0000-7000-8000-0000000000aa',
    actor_type: 'user',
    actor_id: '00000000-0000-7000-8000-0000000000bb',
    action: 'org.settings.changed',
    target_type: 'org_settings',
    target_id: 'x',
    metadata: META,
  },
  {
    id: '00000000-0000-7000-8000-000000000003',
    created_at: '2026-10-11T10:00:59.999999Z',
    org_id: null,
    actor_type: 'system',
    actor_id: null,
    action: 'org.settings.changed',
    target_type: 'org_settings',
    target_id: 'x',
    metadata: META,
  },
];

const LEAVES = [
  'a143d5f46394c830e94985b42f078b178e843487c5b6b04ae96ff0b6cd3d06d4',
  '1751382a38330f6fe7e07c5a8312e67e7a9a1b42398ff53368cba4ec1a8a056e',
  '10dbbdc0010efd367e677f649781ec9c0f8b0d1e5e44d4b30f76f6f3a7aea434',
];

describe('KK-P03c-16: Merkle sabit vektörleri', () => {
  it('kanonik JSON: anahtarlar özyinelemeli sıralı, boşluksuz, UTF-8', () => {
    const [first] = ROWS;
    expect(canonicalJson(first)).toBe(
      '{"action":"org.settings.changed","actor_id":null,"actor_type":"system","created_at":"2026-10-11T10:00:00.000001Z","id":"00000000-0000-7000-8000-000000000001","metadata":{"a":[2,{"c":"ç","d":null}],"b":1},"org_id":null,"target_id":"x","target_type":"org_settings"}',
    );
  });

  it('yaprak = SHA-256(0x00 ‖ kanonik JSON)', () => {
    expect(ROWS.map((r) => leafHash(r).toString('hex'))).toEqual(LEAVES);
  });

  it('kök: tek yaprak kendisi; iç düğüm SHA-256(0x01 ‖ sol ‖ sağ); tek kalan yukarı taşınır', () => {
    const leaves = ROWS.map((r) => leafHash(r));
    expect(merkleRoot(leaves.slice(0, 1)).toString('hex')).toBe(LEAVES[0]);
    expect(merkleRoot(leaves.slice(0, 2)).toString('hex')).toBe(
      '0fa395c58634bdd571e3d269e3327b4ccee388ea7efc239ec86f1fde4c7f49fe',
    );
    expect(merkleRoot(leaves).toString('hex')).toBe(
      '8bc0d6ed189127ac5687dc3f406030a4bc99073f7985833feb43dac4b7ea4155',
    );
    expect(() => merkleRoot([])).toThrow(RangeError);
  });

  it('seal_hash zinciri: ilk mühürde prev 32 sıfır bayt; ikinci mühür öncekine bağlı', () => {
    const leaves = ROWS.map((r) => leafHash(r));
    const start = new Date('2026-10-11T10:00:00Z');
    const end = new Date('2026-10-11T10:01:00Z');
    const seal1 = sealHash({
      prevSealHash: null,
      merkleRoot: merkleRoot(leaves),
      periodStart: start,
      periodEnd: end,
      rowCount: 3,
      chainKey: 'platform',
    });
    expect(seal1.toString('hex')).toBe(
      'bdc63c452ac7434ad8f826ef2249991c9c7e92a94c8efb5b0697236d24fcf1cd',
    );
    const seal2 = sealHash({
      prevSealHash: seal1,
      merkleRoot: merkleRoot(leaves.slice(0, 1)),
      periodStart: end,
      periodEnd: new Date('2026-10-11T10:02:00Z'),
      rowCount: 1,
      chainKey: 'platform',
    });
    expect(seal2.toString('hex')).toBe(
      '730b431893d18261e59554bf23431249bf915bdb62e4c48eee026ffd21ac5d4b',
    );
  });
});
