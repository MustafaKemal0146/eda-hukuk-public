// @tk TK-18
// KK-P11-11 / KK-021-19: uyarlanan yargi-mcp davranış bilgisi için MIT bildirimi (021 §5.16) ve yasak
// içerik taraması: kodda üçüncü taraf arama motoru, başka projelerin kodu veya TLS doğrulamasını kapatan
// seçenek adı geçmez (Y-108, Y-111; 021 §5.13).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO = join(PKG, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|lua)$/.test(n) ? [p] : [];
  });
}

describe('KK-P11-11 / KK-021-19: MIT bildirimi ve yasak içerik', () => {
  it('kök THIRD_PARTY_NOTICES.md yargi-mcp MIT satırını ve tam lisans metnine bağlantıyı içerir', () => {
    const notices = readFileSync(join(REPO, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain('services/yargi-mcp');
    expect(notices).toContain('Copyright (c) 2025 saidsurucu');
    expect(notices).toContain('third_party/yargi-mcp/LICENSE');
    const license = readFileSync(join(REPO, 'third_party/yargi-mcp/LICENSE'), 'utf8');
    expect(license.startsWith('MIT License')).toBe(true);
    expect(license).toContain('Copyright (c) 2025 saidsurucu');
    expect(license).toContain('Permission is hereby granted, free of charge');
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });

  it('servis düzeyi THIRD_PARTY_NOTICES.md tam MIT metnini ve telif satırını içerir; LICENSES kopyası özdeş', () => {
    const notice = readFileSync(join(PKG, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    const license = readFileSync(join(REPO, 'third_party/yargi-mcp/LICENSE'), 'utf8');
    expect(notice).toContain('saidsurucu/yargi-mcp');
    expect(notice).toContain('0.2.2');
    expect(notice).toContain(license.trim());
    expect(readFileSync(join(PKG, 'LICENSES/yargi-mcp-MIT.txt'), 'utf8')).toBe(license);
    const root = readFileSync(join(REPO, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(root).toContain('services/yargi-mcp/THIRD_PARTY_NOTICES.md');
  });

  it('src ve scripts altında üçüncü taraf arama, yasak proje adı ve TLS kapatma seçeneği yok', () => {
    // Desen parçalardan kurulur: bu dosyanın kendisi depo taramasında (check-rules Y-68) eşleşmesin.
    const banned = new RegExp(
      [
        'Bra' + 've',
        'Tav' + 'ily',
        'udf_' + 'toolkit',
        'yargi-' + 'sidecar',
        'rejectUn' + 'authorized',
      ].join('|'),
    );
    const hits = [...files(join(PKG, 'src')), ...files(join(PKG, 'scripts'))].filter((f) =>
      banned.test(readFileSync(f, 'utf8')),
    );
    expect(hits).toEqual([]);
  });
});
