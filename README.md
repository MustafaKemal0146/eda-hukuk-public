<div align="center">

# E.D.A. <em>Hukuk</em>

**Avukatlar için yapay zekâ destekli hukuki araştırma ve taslak çalışma alanı**
<br>Kaynaklı araştırma · Künye Kilidi · Dilekçe stüdyosu · Süre motoru

![Durum](https://img.shields.io/badge/durum-portf%C3%B6y%20projesi-1f3fc4)
![Lisans](https://img.shields.io/badge/lisans-kaynak%20g%C3%B6r%C3%BCn%C3%BCr%20%C2%B7%20ticari%20kullan%C4%B1m%20yasak-b4412f)
![Yığın](https://img.shields.io/badge/y%C4%B1%C4%9F%C4%B1n-TypeScript%20%C2%B7%20Next.js%2016%20%C2%B7%20Hono%20%C2%B7%20PostgreSQL-141821)

</div>

> **Bu bir portföy projesidir ve kaynak görünürdür (source-available); açık kaynak değildir.**
> Kodu okuyabilir, kendi bilgisayarınızda **yalnız kişisel ve ticari olmayan** değerlendirme için
> çalıştırabilirsiniz. **Ticari kullanım, kodun veya mimarisinin başka bir projede kullanılması ya da türev
> eser üretilmesi ve marka adının kullanımı yasaktır.** Ayrıntı: [Lisans](#lisans) ve [`LICENSE`](LICENSE).

## Bu proje nedir?

E.D.A. Hukuk, Türk avukatlarının, stajyer avukatların ve hukuk bürolarının günlük işlerini tek bir çalışma
alanında toplayan bir web uygulamasıdır. Temel fikir, yapay zekâ üretken metin yazarken **atıfların
kaynaktan gelmesidir**: model künye yazmaz, yalnız `[K1]` gibi bir etiket üretir; künye kayıttan oluşturulur
ve resmî kaynak kaydıyla karşılaştırılır.

| Özellik | Kısaca |
|---|---|
| **Kaynaklı sohbet** | Karar ve mevzuat resmî kaynaklarda canlı aranır; yanıtlar kaynak çipleriyle gelir, çipte portal adı ve erişim tarihi görünür. |
| **Künye Kilidi** | Atıf etiketi → kayıttan künye → resmî kaynakta doğrulama. Tırnaklı alıntılar kaynak metinde aranır; bulunamazsa uyarı çıkar. |
| **Dilekçe stüdyosu** | A4 editör, sürüm geçmişi, bul/değiştir, seçili kısmı sohbetle düzenleme, Word/PDF dışa aktarma. |
| **Dosyayla sohbet** | Metinli PDF ve Word dosyaları; virüs taraması, metin çıkarma, kaynak olarak atıf. |
| **Süre motoru** | Süreleri model değil, kural motoru hesaplar. |
| **Müvekkil verisi koruması** | Veri sınıfı kapısı ve maskeleme; veri, izinli olmayan sağlayıcıya gönderilmez. |
| **Yönetim paneli** | Kullanıcı ve limit yönetimi, denetim kaydı, anahtar atama, sistem ve kaynak durumu. |

> E.D.A. Hukuk bir araştırma ve taslak aracıdır; hukuki danışmanlık veya hukuki görüş vermez. Nihai
> değerlendirme avukata aittir. Bu depo, gerçek müvekkil verisiyle üretimde kullanım için hazırlanmış bir ürün
> olarak sunulmamaktadır.

## Mimari

Docker ile çalışan bir monorepo (pnpm + Turborepo; yalnız belge motoru Python/uv).

```
apps/web        Next.js 16 · tanıtım, uygulama arayüzü (yalnız arayüz; iş mantığı yok)
apps/admin      Next.js 16 · yönetim paneli (ayrı yüzey)
apps/api        Hono 4 · uygulama API'si ve ayrı yönetim API'si (iki dinleyici)
apps/worker     BullMQ · dosya tarama, metin çıkarma, e-posta, zamanlanmış işler
services/yargi-mcp   Kaynak aramaları için kendi MCP sunucumuz (durumsuz, salt okur)
services/doc-engine  Python · belge işleme
packages/*      contracts (Zod tek kaynak), db (Drizzle + RLS), ai (LLM geçidi), kvkk (maskeleme),
                legal (süre motoru, künye), editor, ui, crypto, email, observability …
infra/          Compose, Caddy, PostgreSQL/Valkey yapılandırmaları, yayın ve yedek betikleri
```

**Seçilmiş tasarım kararları**

- **Kiracı izolasyonu:** PostgreSQL satır düzeyi güvenlik (RLS); her kiracılı tabloda izolasyon testi.
- **Sırlar:** Kullanıcı ve büro yapay zekâ anahtarları AES-256-GCM ile şifrelenir; yanıtlar anahtarı hiç döndürmez,
  yalnız son 4 karakter görünür; loglarda anahtar, çerez ve istek gövdesi maskelenir.
- **Kimlik:** Parola + TOTP, geçiş anahtarı (passkey), yönetim yüzeyi ayrı kimlik sistemiyle; adım adım doğrulama.
- **Web güvenliği:** İsteğe bağlı nonce'lu CSP, CSRF için origin denetimi, hız sınırları, denetim günlüğü.
- **Yapay zekâ geçidi:** Veri sınıfı (`public` < `client` < `case`) kapısı fail-closed çalışır; sağlayıcı başına
  izinli sınıflar katalogda tanımlıdır; araç seti her istekte aynı sırada gider.
- **Kontrat öncelikli:** Dış sınırlardaki her girdi Zod ile doğrulanır; adlar ve değerler tek kaynaktan gelir.

## Geliştirme süreci

Proje, **Claude Code** ile yapay zekâ destekli geliştirildi; planlama, mimari kararlar, inceleme ve yayın
sorumluluğu proje sahibindedir. Geliştirme sürecindeki toplam yapay zekâ kullanım maliyeti, kullanım
panelinde görüldüğü üzere **yaklaşık 1.400 ABD doları** olmuştur (geliştirici beyanı).

## Yerel olarak çalıştırma (değerlendirme amaçlı)

Host'ta yalnız Docker (Compose v5), Make ve git gerekir.

```bash
git clone https://github.com/MustafaKemal0146/eda-hukuk-final.git
cd eda-hukuk-final
make setup
make dev            # sahte (mock) modelle çalışır; anahtar gerekmez
```

Uygulama `https://app.eda.localhost:8443` adresinde açılır (yerel sertifika; tarayıcı uyarı verebilir). Yerel
e-postalar Mailpit'te görünür: `http://127.0.0.1:8025`. Yığını kapatmak için `make down`.

Yerel bir hesap kurmak için (kayıt, doğrulama, başvuru ve onay adımlarını otomatik yapar):

```bash
DEV_ACCOUNT_PASSWORD='<parola>' make dev-account EMAIL=ben@example.test
```

Başvuruyu onaylayacak yerel bir yönetici ve ayrıntılar için [`docs/gelistirme.md`](docs/gelistirme.md).

## Lisans

**E.D.A. Hukuk Kaynak Görüntüleme ve Değerlendirme Lisansı (v1.0)** — [`LICENSE`](LICENSE)

| | |
|---|---|
| Kodu okumak, incelemek | **Serbest** |
| Kendi bilgisayarınızda kişisel, ticari olmayan değerlendirme için çalıştırmak | **Serbest** |
| Ticari kullanım (şirket içi kullanım ve hizmet olarak sunma dahil) | **Yasak** |
| Kodu, mimarisini, şemalarını, istemlerini veya tasarımını başka bir projede kullanmak, uyarlamak, türev eser üretmek | **Yasak** |
| Yeniden dağıtmak, yayımlamak, canlı hizmet olarak sunmak | **Yasak** |
| Yapay zekâ modeli eğitmek veya veri seti oluşturmak için kullanmak | **Yasak** |
| "E.D.A. Hukuk", "Expert Digital Assistant", logo ve alan adını kullanmak | **Yasak** |

Fikirler serbesttir; lisans kodun, metnin ve tasarımın özgün ifadesini korur. Üçüncü taraf bileşenler kendi
lisanslarına tabidir ([`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)). Ticari lisans veya izin için:
GitHub üzerinden (@MustafaKemal0146).

## Yazar

**Mustafa Kemal Çıngıl** — tasarım, mimari ve geliştirme · [@MustafaKemal0146](https://github.com/MustafaKemal0146)

Telif Hakkı (c) 2026 Mustafa Kemal Çıngıl. Bildirimler: [`NOTICE.md`](NOTICE.md).

---

<details>
<summary><b>English summary</b></summary>

**E.D.A. Hukuk** is an AI-assisted legal research and drafting workspace for Turkish lawyers: source-backed
research with a citation lock (the model emits only a `[K1]` label; the citation is rendered from a record and
checked against the official source), a drafting studio, a rules-engine deadline calculator, and client-data
protection with masking and a data-class gate.

This is a **source-available portfolio project, not open source**. You may read the code and run it unmodified on
your own computer for personal, non-commercial evaluation. Commercial use, reuse or adaptation of any part of the
code/architecture in another project, redistribution, AI-training use and use of the name or domain are
prohibited. See [`LICENSE`](LICENSE). It was built with AI assistance (Claude Code); the author reports a total AI
usage cost of roughly USD 1,400. It is not legal advice and not intended for production use with real client data.

Author: Mustafa Kemal Çıngıl · Contact for licensing: via GitHub (@MustafaKemal0146)

</details>
