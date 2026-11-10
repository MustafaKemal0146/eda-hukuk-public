// RLS manifestinden GRANT deyimleri üretir (031 §11, §14): `rls` migrasyonu yazılırken çıktı dosyaya
// yapıştırılır; uygulanmış migrasyon değişmez, manifest testi canlı ACL'lerle birebirliği doğrular.
// Kullanım: node packages/db/scripts/gen-rls-grants.ts <tablo> [<tablo> ...]
import { grantStatements, MANIFEST_TABLES } from '../src/rls/manifest.ts';

const tables = process.argv.slice(2);
if (tables.length === 0) {
  process.stderr.write(
    `kullanım: gen-rls-grants.ts <tablo>...\ntablolar: ${MANIFEST_TABLES.join(' ')}\n`,
  );
  process.exitCode = 2;
}
for (const t of tables) {
  if (!MANIFEST_TABLES.includes(t)) {
    process.stderr.write(`manifestte yok: ${t}\n`);
    process.exitCode = 1;
    continue;
  }
  for (const line of grantStatements(t)) process.stdout.write(`${line}\n`);
}
