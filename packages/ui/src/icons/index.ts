// @eda/ui/icons genel yüzeyi (adlandırılmış yeniden dışa aktarım; `export *` yok).
// Lucide bileşenleri dışa aktarılmaz: tüketiciler yalnız semantik adla `Icon` kullanır.
export {
  ICON_SIZE_PX,
  ICON_STROKE_WIDTH,
  Icon,
  type IconName,
  type IconProps,
  type IconSize,
} from './icon.tsx';
export { ICON_NAMES } from './registry.ts';
