# @eda/yargi-mcp

Kamu hukuk kaynakları için durumsuz, salt-okur MCP sunucusu (021 §5, P11). Beş araç sunar ve tek dış
kapıdır: `search_decisions`, `get_decision`, `search_legislation_live`, `get_legislation_live`,
`source_status`. Yalnız `valkey-cache` (kova, kesici, önbellek, tek uçuş) ve `egress-portal` vekiline
bağlanır; Postgres, ana `valkey`, objstore, doc-engine ve LLM'e bağlanmaz. Sorgu ve belge metni log,
Valkey anahtarı / değeri ve span'a yazılmaz.

## Dizin (013 §8)

| Yol | İçerik |
|---|---|
| `src/main.ts`, `app.ts`, `server.ts` | Giriş, `POST /mcp` (istek başına `McpServer`), kapanış |
| `src/auth/` | Servis JWT doğrulaması (EdDSA, `aud`, `exp-iat ≤ 60`) |
| `src/config/` | Ortam okuma (`@eda/contracts` env şeması), `eda:cfg:sources` okuyucusu |
| `src/health/` | `GET /health` |
| `src/http/` | `fetch` taşıyıcısı (vekil, zaman aşımı, boyut sınırı), fixture kaydı ve replay |
| `src/resilience/` | Lua kova ve öncelik sınıfları, devre kesici, önbellek, tek uçuş, belge tamponu |
| `src/sources/<kaynak>/` | Bedesten, AYM, Uyuşmazlık, mevzuat istemcileri, kimlik doğrulayıcıları, `normalize.ts` |
| `src/tools/` | Beş aracın işleyicileri |
| `src/transform/` | HTML / PDF dönüştürme, sorgu terimleri ve madde sıralaması, bölüm üst sınırı |
| `test/` | `unit`, `contract`, `security`, `integration` ve kayıtlı portal fixture'ları |

Karar bölümleme ve mevzuat madde ayrıştırma `@eda/legal/sections` ile yapılır (034 §6, §9.3); kural
değişikliği korpus alımını da etkiler.

## Ortam

Değişkenler 002 §5.1 ve §5.6'dadır; şema `@eda/contracts` (`yargi-mcp` env). Başlıcaları:
`MCP_PORT`, `INTERNAL_JWT_PUBLIC_KEY_FILE`, `INTERNAL_JWT_AUDIENCE`, `VALKEY_CACHE_URL`,
`VALKEY_CACHE_USERNAME`, `VALKEY_CACHE_PASSWORD_FILE`, `YARGI_SOURCES_ENABLED`, `SOURCE_USER_AGENT`,
`HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1`, `SOURCE_FIXTURE_MODE` (`off` | `replay`), `NODE_EXTRA_CA_CERTS`.
Sırlar yalnız `*_FILE` ile okunur.

## Fixture kaydı ve replay

- Kayıt yalnız geliştirici makinesinden ve elle yapılır, CI'da çalışmaz:
  `pnpm --filter @eda/yargi-mcp fixtures:record [-- --source <kaynak>]`. Kaynak oran sınırlarına uyar,
  toplam en çok 40 istek; sorgular kamu hukuk terimleridir.
- Kayıtlar `test/fixtures/<kaynak>/<senaryo>.json` (`meta` + `response`) dosyalarıdır. Elle yazılmış
  kayıt `"synthetic": true` taşır; şekli doğrulanmamış kayıtla "çalışıyor" raporlanmaz (P11 K11).
- `SOURCE_FIXTURE_MODE=replay`: istekler yöntem + URL + gövde imzasıyla kayıttan yanıtlanır; kaydı
  olmayan istek ağa çıkmaz, `SOURCE_UNAVAILABLE` döner. Yalnız `EDA_ENV` `development` veya `test`
  iken kabul edilir; başka ortamda süreç başlamaz (KK-P11-19). Test compose katmanı bu kipi kullanır
  ve kayıtları salt-okur bağlar (`infra/compose/compose.test.yaml`).
- Birim testleri ağa çıkmaz (replay veya betikli taşıyıcı).

## Canary

Kaynak başı canary işi ve sonucu (`source_status.last_canary`) P12'de eklenir; o zamana dek alan
`null` döner. Gerçek portala canary dışında yalnız `fixtures:record` gider.

## Yeni kaynak ekleme

Yeni kaynak yalnız şu sırayla eklenir: 002 (kaynak kodu, config, env, Valkey adları; ayrı
`docs(canon)` commit'i), 082 kaynak kataloğu (kapsam, oran sınırı, CAPTCHA / WAF durumu), egress izin
listesi (`infra/egress`, hassas yol) ve CODEOWNERS onayı. CAPTCHA'lı veya WAF'lı portal, tarayıcı
taklidi ve üçüncü taraf arama motoru eklenmez (Y-66, Y-68). V1.1 kaynakları (KİK, Rekabet,
GİB) MVP'de açılmaz.

## Lisans

Uyarlanan davranış bilgisi için MIT bildirimi: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
