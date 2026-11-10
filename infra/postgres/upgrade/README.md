# infra/postgres/upgrade

initdb betikleri (`infra/postgres/initdb/`) **yalnız boş veri biriminde** koşar. Mevcut bir kümeye
sonradan rol, rol üyeliği, rol ayarı, eklenti veya FTS sözlüğü eklemek bu dizindeki
`NNN-<konu>.sql` betikleriyle ve 073 runbook'una göre, **`postgres` süper kullanıcısıyla** yapılır
(032 §6.2). `migrate` bunları oluşturmaz; yalnız varlığını doğrular ve eksikse ön koşul denetiminde
çıkış 10 ile durur.

Kurallar:

- Her betik yinelenebilirdir (ikinci çalıştırma kümeyi değiştirmez) ve `\set ON_ERROR_STOP on` taşır.
- Aynı değişiklik aynı commit'te ilgili `initdb/` dosyasına da işlenir: yeni kümeler initdb'den,
  mevcut kümeler buradan aynı duruma gelir.
- Parola veya sır içermez; parola döndürme ayrı runbook adımıdır (073).
- Numara yeniden kullanılmaz; uygulanan betikler silinmez.

Dev kümesine uygulama (betik konteynıra stdin ile verilir; birim silinmez):

```bash
infra/scripts/dev/dc.sh dev exec -T postgres psql -U postgres -d eda < infra/postgres/upgrade/NNN-<konu>.sql
```

| Betik | initdb karşılığı | Neden |
|---|---|---|
| `001-eda-owner-read-settings.sql` | `010-roles.sql` | migrate ön koşulu `shared_preload_libraries` okur (AS-0079) |
