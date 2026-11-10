// Mimari sınır kuralları (013 §19). Yollar repo kökünden görelidir.
// Yeni kural eklemek serbesttir; kural gevşetmek CODEOWNERS onayı ister.

const NODE_CORE =
  '^(node:|assert|buffer|child_process|cluster|crypto|dgram|dns|fs|http|http2|https|inspector|module|net|os|path|perf_hooks|process|readline|stream|tls|tty|url|util|v8|vm|worker_threads|zlib)(/|$)';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-packages-to-apps',
      comment: 'packages/* uygulamalara, servislere, eval ve testlere bağımlı olamaz (002 §8).',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(apps|services|evals|tests)/' },
    },
    {
      name: 'no-cross-app',
      comment: 'Uygulamalar ve servisler birbirini içe aktarmaz; yalnız ağ üzerinden konuşur.',
      severity: 'error',
      from: { path: '^(apps|services)/([^/]+)/' },
      to: { path: '^(apps|services)/', pathNot: '^$1/$2/' },
    },
    {
      name: 'db-only-backend',
      comment: '@eda/db yalnız api, worker ve kendi içinden kullanılır (002 §8).',
      severity: 'error',
      from: { pathNot: '^(apps/api|apps/worker|packages/db)/' },
      to: { path: '^packages/db/' },
    },
    {
      name: 'db-auth-subpath',
      comment: '@eda/db/auth (eda_auth havuzu) yalnız apps/api/src/auth/** içinden (031 §4.5).',
      severity: 'error',
      from: { pathNot: '^(apps/api/src/auth/|packages/db/)' },
      to: { path: '^packages/db/src/auth\\.ts$' },
    },
    {
      name: 'db-admin-subpath',
      comment:
        '@eda/db/admin (eda_readonly_admin havuzu) yalnız apps/api/src/admin/** içinden (031 §4.5).',
      severity: 'error',
      from: { pathNot: '^(apps/api/src/admin/|packages/db/)' },
      to: { path: '^packages/db/src/admin\\.ts$' },
    },
    {
      name: 'db-jobs-subpath',
      comment:
        '@eda/db/jobs (eda_jobs, BYPASSRLS) yalnız jobs girişi ve bakım işleyicilerinden (031 §4.5; AS-0173).',
      severity: 'error',
      from: {
        pathNot:
          '^(apps/worker/src/(jobs\\.ts$|jobs/|db/jobs-pool\\.ts$|processors/maintenance/)|packages/db/)',
      },
      to: { path: '^packages/db/src/jobs(\\.ts$|/)' },
    },
    {
      name: 'db-testing-only-tests',
      comment:
        '@eda/db/testing (eda_owner fixture havuzu) yalnız test dosyalarından (P04a; uygulama kodu göremez).',
      severity: 'error',
      from: { pathNot: '^(packages/db/|(apps|packages)/[^/]+/test/)' },
      to: { path: '^packages/db/src/testing\\.ts$' },
    },
    {
      name: 'pg-only-db',
      comment:
        'pg sürücüsü ve drizzle-orm/node-postgres yalnız packages/db ve apps/api/src/auth içinden (Y-98, KK-031-4).',
      severity: 'error',
      from: { pathNot: '^(packages/db|apps/api/src/auth)/' },
      to: { path: '(^|/)node_modules/(pg|drizzle-orm/node-postgres)(/|$)' },
    },
    {
      name: 'no-s3-presign',
      comment:
        'Presigned URL ve doğrudan nesne yüklemesi/indirmesi YASAK: tarayıcı objstore’a erişmez (033 D1, KK-033-24).',
      severity: 'error',
      from: {},
      to: { path: '(^|/)node_modules/@aws-sdk/(s3-request-presigner|s3-presigned-post)(/|$)' },
    },
    {
      name: 'ai-only-backend',
      comment: '@eda/ai yalnız api ve worker tarafından kullanılır (002 §8).',
      severity: 'error',
      from: { pathNot: '^(apps/api|apps/worker|packages/ai)/' },
      to: { path: '^packages/ai/' },
    },
    {
      name: 'ui-only-contracts',
      comment: '@eda/ui yalnız @eda/contracts paketine bağımlıdır.',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: { path: '^packages/', pathNot: '^packages/(ui|contracts|config)/' },
    },
    {
      name: 'no-radix',
      comment:
        'Radix kullanılmaz; birincil bileşen kütüphanesi Base UI (052 §1, KK-052-4, KK-P05-19/24).',
      severity: 'error',
      from: { path: '^(packages/ui|apps/web|apps/admin)/' },
      to: { path: '(^|/)@radix-ui/' },
    },
    {
      name: 'contracts-leaf',
      comment: '@eda/contracts hiçbir iç pakete bağımlı olmaz (013 §1 ilke 3).',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { path: '^packages/', pathNot: '^packages/(contracts|config)/' },
    },
    {
      name: 'pure-no-io',
      comment: 'Saf paketlerin src/ dizini G/Ç modülü kullanmaz (test ve betikler hariç).',
      severity: 'error',
      from: { path: '^packages/(contracts|kvkk|legal|editor)/src/' },
      to: {
        dependencyTypes: ['core', 'npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg'],
        path: [NODE_CORE, '(^|/)node_modules/(pg|ioredis|bullmq)/'],
      },
    },
    {
      name: 'kvkk-only-contracts',
      comment:
        '@eda/kvkk saf motordur: src yalnız @eda/contracts iç paketine bağımlıdır (P08.3; db, ai, legal, crypto yasak).',
      severity: 'error',
      from: { path: '^packages/kvkk/src/' },
      to: { path: '^packages/', pathNot: '^packages/(kvkk|contracts)/' },
    },
    {
      name: 'crypto-only-node-crypto',
      comment: '@eda/crypto çekirdek modüllerden yalnız node:crypto kullanabilir.',
      severity: 'error',
      from: { path: '^packages/crypto/src/' },
      to: { dependencyTypes: ['core'], pathNot: '^(node:)?crypto$' },
    },
    {
      name: 'editor-headless',
      comment: '@eda/editor başsızdır; React ve React TipTap eklentileri yasak.',
      severity: 'error',
      from: { path: '^packages/editor/' },
      to: {
        path: '(^|/)node_modules/(react|react-dom|@tiptap/react|@tiptap/extension-drag-handle-react)/',
      },
    },
    {
      name: 'yargi-mcp-deps',
      comment:
        'yargi-mcp yalnız saf paketlere bağımlıdır: contracts, observability, legal, kvkk (013 §8; P11 K5 genişletmesi). ai, db, crypto, editor yasak.',
      severity: 'error',
      from: { path: '^services/yargi-mcp/' },
      to: {
        path: '^packages/',
        pathNot: '^packages/(contracts|observability|config|legal|kvkk)/',
      },
    },
    {
      name: 'api-routes-no-db',
      comment: 'Rota katmanı SQL ve depo katmanını görmez (013 §6).',
      severity: 'error',
      from: { path: '^apps/api/src/routes/' },
      to: {
        path: [
          '^apps/api/src/(repositories|db)/',
          '^packages/db/',
          '(^|/)node_modules/drizzle-orm/',
        ],
      },
    },
    {
      name: 'api-services-no-http',
      comment: 'Servis ve depo katmanı HTTP çatısını bilmez (013 §6).',
      severity: 'error',
      from: { path: '^apps/api/src/(services|repositories)/' },
      to: {
        path: ['(^|/)node_modules/(hono|@hono/[^/]+)/', '^apps/api/src/(routes|middleware)/'],
      },
    },
    {
      name: 'api-repos-no-services',
      comment: 'Depo katmanı servis katmanını çağırmaz.',
      severity: 'error',
      from: { path: '^apps/api/src/repositories/' },
      to: { path: '^apps/api/src/services/' },
    },
    {
      name: 'auth-db-isolated',
      comment: 'auth şemasına tek erişim noktası apps/api/src/auth (002 §5.2).',
      severity: 'error',
      from: { pathNot: '^(apps/api/src/auth|packages/db)/' },
      to: { path: ['^apps/api/src/auth/auth-db\\.ts$', '^packages/db/src/schema/auth\\.ts$'] },
    },
    {
      name: 'admin-surface-isolated',
      comment: 'Uygulama dinleyicisinden admin rotalarına ve salt-okur admin havuzuna erişilemez.',
      severity: 'error',
      from: { path: '^apps/api/src/app\\.ts$' },
      to: {
        path: ['^apps/api/src/routes/admin/', '^apps/api/src/db/admin-ro-pool\\.ts$'],
        reachable: true,
      },
    },
    {
      name: 'worker-no-maintenance',
      comment: 'Bakım işleri ve eda_jobs havuzu yalnız jobs girişinden erişilir (KK-002-12).',
      severity: 'error',
      from: { path: '^apps/worker/src/main\\.ts$' },
      to: {
        path: '^apps/worker/src/(processors/maintenance/|jobs/|db/jobs-pool\\.ts$)',
        reachable: true,
      },
    },
    {
      name: 'jobs-only-maintenance',
      comment: 'jobs girişi yalnız bakım işleyicilerine erişir (eda_jobs BYPASSRLS).',
      severity: 'error',
      from: { path: '^apps/worker/src/jobs\\.ts$' },
      to: {
        path: '^apps/worker/src/processors/',
        pathNot: '^apps/worker/src/processors/maintenance/',
        reachable: true,
      },
    },
    {
      name: 'no-migrate-in-request-path',
      comment: 'Migrasyon ve seed kodu istek yolundan içe aktarılamaz.',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^packages/db/(src/)?(bin|seed)/' },
    },
    {
      name: 'evals-black-box',
      comment: 'Eval koşucusu sistemi kara kutu olarak dener (013 §12).',
      severity: 'error',
      from: { path: '^evals/' },
      to: { path: '^packages/', pathNot: '^packages/(contracts|kvkk|legal|api-client|config)/' },
    },
    {
      name: 'e2e-contracts-only',
      comment: 'E2E testleri yalnız sözleşmeleri içe aktarır.',
      severity: 'error',
      from: { path: '^tests/e2e/' },
      to: { path: '^packages/', pathNot: '^packages/(contracts|config)/' },
    },
    {
      name: 'no-unresolvable',
      comment: 'Çözülemeyen içe aktarma: paket package.json içinde bildirilmemiş veya yol hatalı.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      comment: 'Çalışma zamanı döngüsü yasak; yalnız `import type` döngüleri derlemede silinir.',
      severity: 'error',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Üretim kodu (src/) devDependencies paketlerini kullanamaz.',
      severity: 'error',
      from: { path: '^(apps|packages|services)/[^/]+/src/' },
      to: { dependencyTypes: ['npm-dev'], pathNot: '(^|/)node_modules/@types/' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)[^/]+\\.config\\.(js|cjs|mjs|ts)$',
          '(^|/)test/',
          '(^|/)scripts/',
          '(^|/)bin/',
          '(^|/)src/(main|jobs|index|proxy)\\.ts$',
          '^apps/(web|admin)/src/app/',
          '^packages/[^/]+/src/',
          '^packages/config/',
          '^tests/e2e/specs/',
          '^evals/src/',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['(^|/)(dist|\\.next|generated|node_modules)/'] },
    tsPreCompilationDeps: true,
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
