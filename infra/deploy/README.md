# infra/deploy

İmza doğrulama açık anahtarlarının yeri (072 §2.2, §8.4). Bu dizin CODEOWNERS iki-onay bloğundadır
(`/infra/deploy/`): her değişiklik `sensitive-paths` işinde inceleme oturumu kaydı ve `second-review`
ister. Dizinde **özel anahtar, parola veya sır bulunmaz**.

| Dosya | Ne zaman eklenir | Kaynak |
|---|---|---|
| `cosign-build.pub` | Build anahtarı töreninden sonra, ayrı PR ile | `infra/ci/cosign-ceremony.md` (IG-27) |
| `cosign-promote.pub` | Promote anahtarı töreninden sonra | P33 |
| `cosign-build.pub.<yıl>`, `cosign-promote.pub.<yıl>` | Rotasyonda eski anahtar | 072 §8.2, 073 §9 |

Dağıtım betikleri (`infra/scripts/deploy/`) ve `deploy-tools` araç imajı P33'te yazılır.
