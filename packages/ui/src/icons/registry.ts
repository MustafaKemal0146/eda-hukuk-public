// İkon kaydı: semantik ad -> Lucide bileşeni (051 §11; P05.7). `lucide-react` YALNIZ
// packages/ui/src/icons/ altında içe aktarılır; bileşenler semantik adı kullanır
// (`<Icon icon="status.verified" />`). Adlandırılmış içe aktarma (ağaç sallama); ikon yazı tipi,
// Material Symbols, emoji ve CDN yok. Yeni ad = bu dosya + test/icons.test.ts.
//
// Lucide 1.x yeniden adlandırmaları (eski ad -> kanonik bileşen; eski ad takma ad olarak
// sınıf listesinde kalır, test bunu doğrular): `building-2` -> BuildingComplex,
// `file-warning` -> FileExclamationPoint, `history` -> RotateCcwClock.
import {
  AlarmClock,
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Ban,
  Bell,
  BookOpen,
  Briefcase,
  BuildingComplex,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarX,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleQuestionMark,
  CircleX,
  Clock,
  CloudOff,
  Copy,
  DoorClosed,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck,
  FileDown,
  FileExclamationPoint,
  FileText,
  FlaskConical,
  FolderLock,
  FolderOpen,
  Gavel,
  GitCompare,
  Globe,
  GripVertical,
  Handshake,
  Info,
  LifeBuoy,
  LoaderCircle,
  Lock,
  type LucideIcon,
  MapPin,
  Menu,
  MessageSquare,
  Minus,
  Monitor,
  Moon,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Quote,
  RefreshCw,
  RotateCcw,
  RotateCcwClock,
  Scale,
  ScanSearch,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Square,
  SquareCheck,
  SquarePen,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  UserCheck,
  UserSearch,
  Users,
  X,
} from 'lucide-react';

export const ICON_REGISTRY = {
  // 051 §11 tablosu (birebir)
  brand: Scale, // scale (geçici marka; 051 Açık Soru 1)
  'nav.chat': MessageSquare, // message-square
  'nav.new-chat': SquarePen, // square-pen
  'nav.decisions': Gavel, // gavel
  'nav.legislation': BookOpen, // book-open
  'nav.kunye-check': ScanSearch, // scan-search
  'nav.files': FolderOpen, // folder-open
  'nav.documents': FileText, // file-text
  'nav.calendar': CalendarDays, // calendar-days
  'nav.firm': BuildingComplex, // building-2
  'nav.partner': Handshake, // handshake
  'nav.settings': Settings, // settings
  'nav.support': LifeBuoy, // life-buoy
  'nav.search': Search, // search
  'action.attach': Paperclip, // paperclip
  'action.send': ArrowUp, // arrow-up
  'action.stop': Square, // square
  'action.copy': Copy, // copy
  'action.regenerate': RefreshCw, // refresh-cw
  'action.feedback-up': ThumbsUp, // thumbs-up
  'action.feedback-down': ThumbsDown, // thumbs-down
  'action.export': Download, // download
  'action.close': X, // x
  'action.more': Ellipsis, // ellipsis
  'action.external': ExternalLink, // external-link
  'status.verified': CircleCheck, // circle-check
  'status.blocked': CircleX, // circle-x
  'notice.info': Info, // info
  'notice.warning': TriangleAlert, // triangle-alert
  'notice.error': CircleX, // circle-x
  'theme.light': Sun, // sun
  'theme.dark': Moon, // moon
  'theme.system': Monitor, // monitor

  // Durum aileleri (051 §4.2; `Tone` ile aynı adlar; violet/teal bağlama göre simge alır)
  'tone.success': CircleCheck, // circle-check
  'tone.warning': TriangleAlert, // triangle-alert
  'tone.danger': CircleX, // circle-x
  'tone.info': Info, // info
  'tone.neutral': CircleMinus, // circle-minus

  // Genel yükleniyor (Loader, Button loading); azaltılmış harekette statik `clock` (051 §10.2)
  'status.loading': LoaderCircle, // loader-circle
  'status.loading-static': Clock, // clock

  // Künye durumları (052 §6.2, 051 §4.3)
  'citation.pending': LoaderCircle, // loader-circle
  'citation.pending-static': Clock, // clock
  'citation.verified': CircleCheck, // circle-check
  'citation.verified-user-source': FileCheck, // file-check
  'citation.out-of-context': CircleAlert, // circle-alert
  'citation.out-of-coverage': Ban, // ban
  'citation.source-unavailable': CloudOff, // cloud-off
  'citation.not-found': CircleX, // circle-x
  'citation.attested': UserCheck, // user-check
  'citation.unresolved': CircleQuestionMark, // circle-question-mark (çözülemeyen etiket, 052 §6.1)
  'citation.no-status': CircleDashed, // circle-dashed (durum henüz gelmedi, 052 §6.1)

  // Veri sınıfı ve sağlayıcı rozeti (051 §4.4, 052 §5.4)
  'data-class.public': Globe, // globe
  'data-class.client': Briefcase, // briefcase
  'data-class.case': FolderLock, // folder-lock
  'provider.region': MapPin, // map-pin
  'provider.simulation': FlaskConical, // flask-conical

  // Belge durumu (051 §4.5)
  'document.draft': Pencil, // pencil
  'document.review-pending': Clock, // clock
  'document.approved': CircleCheck, // circle-check
  'document.exported': FileDown, // file-down
  'document.filed-declared': FileCheck, // file-check
  'document.archived': Archive, // archive

  // Evrak durumu (051 §4.5)
  'file.processing': LoaderCircle, // loader-circle
  'file.processing-static': Clock, // clock
  'file.ready': CircleCheck, // circle-check
  'file.failed': CircleX, // circle-x
  'file.quarantined': ShieldAlert, // shield-alert
  'file.ocr-skipped': FileExclamationPoint, // file-warning

  // Mesaj durumu (051 §4.5)
  'message.streaming': LoaderCircle, // loader-circle
  'message.stopped': Square, // square
  'message.interrupted': TriangleAlert, // triangle-alert
  'message.error': CircleX, // circle-x

  // Süre Kilidi (051 §4.5)
  'deadline-check.match': CalendarCheck, // calendar-check
  'deadline-check.mismatch': CalendarX, // calendar-x
  'deadline-check.no-calculation': CalendarClock, // calendar-clock

  // Öneri durumu (051 §4.5)
  'suggestion.pending': GitCompare, // git-compare
  'suggestion.stale': RotateCcwClock, // history

  // Etkinlik türleri (051 §4.6)
  'event.hearing': Gavel, // gavel
  'event.deadline': AlarmClock, // alarm-clock
  'event.discovery': MapPin, // map-pin
  'event.expert': UserSearch, // user-search
  'event.meeting': Users, // users
  'event.mediation': Handshake, // handshake
  'event.task': SquareCheck, // square-check

  // İlkel bileşen denetimleri (P05.9–P05.13)
  'action.retry': RotateCcw, // rotate-ccw (ErrorState yeniden dene)
  'control.check': Check, // check (Checkbox, Select/Combobox öğesi, Stepper)
  'control.indeterminate': Minus, // minus (Checkbox belirsiz)
  'control.chevron-down': ChevronDown, // chevron-down (Select, Accordion, DropdownMenu)
  'control.chevron-up': ChevronUp, // chevron-up
  'control.chevron-left': ChevronLeft, // chevron-left (Pagination önceki)
  'control.chevron-right': ChevronRight, // chevron-right (Breadcrumb, Pagination sonraki)
  'control.chevrons-up-down': ChevronsUpDown, // chevrons-up-down (Combobox tetikleyici)
  'control.show-password': Eye, // eye (PasswordInput)
  'control.hide-password': EyeOff, // eye-off (PasswordInput)
  'control.date': Calendar, // calendar (DateField)
  'control.time': Clock, // clock (TimeField)
  'control.upload': Upload, // upload (FileInput)
  'control.camera': Camera, // camera (FileInput capture)
  'control.sort-asc': ArrowUp, // arrow-up (DataTable aria-sort)
  'control.sort-desc': ArrowDown, // arrow-down
  'control.sort-none': ArrowUpDown, // arrow-up-down
  'control.splitter': GripVertical, // grip-vertical (Splitter tutamağı)
  'control.locked': Lock, // lock (NavItem kilitli, LockedFeatureState)
  'control.avatar': User, // user (Avatar görsel yok)
  'control.scroll-to-latest': ArrowDown, // arrow-down (ConversationView "En son yanıta git")
  // Uygulama kabuğu ve sayfa kalıpları (P05/P06)
  'nav.menu': Menu, // menu (mobil çekmece)
  'nav.notifications': Bell, // bell
  'nav.account': User, // user (hesap menüsü)
  'action.add': Plus, // plus (yeni klasör, belge, etkinlik)
  'action.forward': ArrowRight, // arrow-right (birincil düğme arka simgesi)
  'action.pause': Pause, // pause (alıntı karuseli)
  'action.play': Play, // play
  'action.delete': Trash2, // trash-2 (son sohbeti sil)
  quote: Quote, // quote (alıntı paneli)
  'status.secure': ShieldCheck, // shield-check (şifreli bağlantı, KVKK)
  'security.gate': DoorClosed, // door-closed (veri sınıfı kapısı, tanıtım sayfası)
} as const satisfies Record<string, LucideIcon>;

/** Kayıtlı semantik ikon adı. */
export type IconName = keyof typeof ICON_REGISTRY;

/** Kayıttaki tüm adlar (vitrin ve testler için; sıra kayıt sırasıdır). */
export const ICON_NAMES = Object.freeze(Object.keys(ICON_REGISTRY) as IconName[]);
