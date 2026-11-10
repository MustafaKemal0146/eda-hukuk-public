# Geliştirme notları

Bu belge yerel geliştirme yığınının nasıl çalıştırılacağını anlatır. Kullanım koşulları için [`LICENSE`](../LICENSE).
Yalnız kişisel, ticari olmayan değerlendirme amaçlıdır.


## Başlangıç

Host'ta yalnız Docker (Compose v5), Make ve git gerekir; Node ve Python araçları konteynırda koşar.

```bash
make setup      # git kancaları + bağımlılıklar
make lint typecheck test
make help       # tüm hedefler
```

## Yerel yığını çalıştırma (gerçek model)

Yığın sürekli açık kalsın; `make down` yapmayın. Uygulama: `https://app.eda.localhost:8443`.

**İlk kurulum** (imajlar derlenir, birkaç dakika sürer):

```bash
DEV_REAL_LLM=anthropic make dev LLM=real
```

**İlk kurulumdan sonra bir şey değişmediyse** (derleme atlanır, yaklaşık 11 sn):

```bash
DEV_NO_BUILD=1 DEV_REAL_LLM=anthropic make dev LLM=real
```

**Kod değiştirdiysen** (yalnız değişen servis yeniden derlenir):

```bash
DEV_REAL_LLM=anthropic make dev LLM=real
```

Notlar:

- Web/admin doğrudan portları (3000/3001) başka bir proje tarafından tutuluyorsa otomatik bir
  sonraki boş porta kayar; uygulamaya erişim Caddy üzerinden (`8443`) aynı kalır.

## Sahte modelle hızlı deneme (anahtarsız)

Gerçek model anahtarı olmadan arayüzü ve akışı denemek için sahte (mock) model kullanılır; yanıtlar örnek
senaryodan gelir, ekranda "Simülasyon" şeridi görünür:

```bash
make setup
LLM=mock EMBED=none make dev PROFILES=""     # veya: make dev
```

## Yerel hesap kurma

Kayıt, e-posta doğrulama, başvuru ve onay adımlarını otomatik yapan yardımcı (yalnız yerel):

```bash
DEV_ACCOUNT_PASSWORD='<parola>' make dev-account EMAIL=ben@example.test          # TOTP=1 ekleyerek 2 adımlı doğrulamayla
# Başvuruyu onaylayacak yerel bir yönetici (tek kullanımlık passkey kayıt bağlantısı yazdırır):
COMPOSE_PROFILES=core,admin,mcp,ai,docs,av,hot infra/scripts/dev/dc.sh dev exec -T api \
  node dist/cli.js create-staff --email yonetici@example.test --name "Yönetici" --role super_admin --print-url
make approve-user EMAIL=ben@example.test AS=yonetici@example.test
```

Yerel e-postalar Mailpit'te görünür: `http://127.0.0.1:8025`.
