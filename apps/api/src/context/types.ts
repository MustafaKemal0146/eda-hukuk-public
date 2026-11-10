// Hono bağlam değişkenleri (040 §3, §5.8, §5.10). İstek bağlamı modül değişkeninde tutulmaz; yalnız
// c.var. Ad ve e-posta c.var'a KONMAZ (log sızıntısı önlemi; servis gerekiyorsa kendisi okur).
import type {
  MemberRole,
  MfaLevel,
  OrgKind,
  PlatformRole,
  VerificationStatus,
} from '@eda/contracts/enums';
import type { PermissionSettings } from '@eda/contracts/permissions';
import type { EdaLogger } from '@eda/observability/logger';
import type { RouteMeta } from '../routing/define-route.ts';

export type Surface = 'app' | 'admin';

export interface SessionVar {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly mfaLevel: MfaLevel;
  readonly stepUpAt: Date | null;
  readonly activeOrganizationId: string | null;
}

export interface UserVar {
  readonly id: string;
  readonly platformRole: PlatformRole;
  readonly verificationStatus: VerificationStatus;
}

export interface TenantVar {
  readonly orgId: string;
  readonly userId: string;
  readonly memberRole: MemberRole;
  readonly orgKind: OrgKind;
  /** `org_settings.mfa_required_all` (042 §5.1; `mfaGate`). */
  readonly mfaRequiredAll: boolean;
  /** Koşullu izinlerde okunan büro ayarı alt kümesi (042 Açık Soru 3). */
  readonly settings?: PermissionSettings;
}

export type SurfaceEnv = {
  Variables: {
    requestId: string;
    routeMeta: RouteMeta | undefined;
    /** `YÖNTEM /şablon/{param}` (kayıt defteri anahtarı). */
    routeKey: string | undefined;
    session: SessionVar | undefined;
    user: UserVar | undefined;
    tenant: TenantVar | null | undefined;
    /** Yönetim yüzeyi: personelin görünen adı ve oturum bitişi (yalnız `adminSession`). */
    adminName: string | undefined;
    adminSessionExpiresAt: Date | undefined;
  };
};

/** Süreç geneli değişebilir durum: drenaj bayrağı shutdown.ts tarafından çevrilir. */
export type RuntimeState = {
  draining: boolean;
};

export type SurfaceDeps = {
  surface: Surface;
  logger: EdaLogger;
  state: RuntimeState;
  /** Bakım modu (system.maintenanceMode); P01b'de config, P03+ system_settings anlık görüntüsü. */
  maintenanceMode: () => boolean;
  jsonBodyMaxBytes: number;
};
