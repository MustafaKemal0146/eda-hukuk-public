// MASKER_VERSION (026 §1.2) = <semver>+<sha256(algılayıcı kodu ‖ data/* ‖ legal-terms) ilk 8 hex>.
// Özet derleme zamanında `scripts/gen-version.ts` ile üretilir (pnpm gen:schemas); src altındaki her
// kaynak dosyası (bu dosya, üretilen dosya ve index.ts hariç) özete girer. Test, üretilen değerin güncel
// olduğunu ve veri değişince değiştiğini sınar (KK-P08-14).
import { MASKER_CONTENT_HASH } from './version.generated.ts';

export const MASKER_SEMVER = '0.1.0';
export const MASKER_VERSION = `${MASKER_SEMVER}+${MASKER_CONTENT_HASH}`;
