// Personel modülleri (Şablonlar, Destek, Veri seti) ortak yetki meta'sı.
// Varsayım: bu üç modülün ayrı `platform:*` izin adı 042 §8.4'te yoktur ve plan seti salt okurdur;
// okuma `support` ve `super_admin` içindir, bu yüzden mevcut STAFF okuma izni (`platform:audit_read`)
// kullanılır. Değiştirici işlem yalnız `super_admin` + step-up (`platform:system_settings_write`).
// Ayrı adlar (ör. `platform:support_read`) eklenirse yalnız bu iki sabit değişir.
import type { RouteMeta } from '../../routing/define-route.ts';
import { ADMIN_READ } from './me.ts';

export const STAFF_READ_META: RouteMeta = { ...ADMIN_READ, permission: 'platform:audit_read' };
export const SUPER_WRITE_META: RouteMeta = {
  ...ADMIN_READ,
  permission: 'platform:system_settings_write',
  stepUp: true,
  body: 'json',
};
