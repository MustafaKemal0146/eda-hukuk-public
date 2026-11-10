// Evrak servisleri ortak türleri ve yardımcıları (yükleme ve indirme paylaşır).
import type { EdaEnv } from '@eda/contracts/config/env';
import type { MemberRole } from '@eda/contracts/enums';
import { HEADER_BYTES, SEGMENT_PLAIN_BYTES, TAG_BYTES } from '@eda/crypto';
import type { TenantTx } from '@eda/db';
import type { Keyring } from '@eda/db/keyring';
import type { ObjectStore } from '@eda/db/s3';
import type { FileJobProducer } from '../../queue/file-producer.ts';
import type { DownloadTokenStore } from './tokens.ts';

export interface FilesDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
}

export interface FileActor {
  readonly orgId: string;
  readonly userId: string;
  readonly memberRole: MemberRole;
  /** Oturum kimliği: indirme belirteci oturuma bağlıdır (033 §10.4). */
  readonly sessionId?: string | undefined;
}

export interface FilesLimits {
  readonly maxBytes: number;
  readonly maxFilesPerCase: number;
  readonly maxConcurrentPerUser: number;
  readonly maxConcurrentApi: number;
  readonly deleteGraceDays: number;
  readonly inboxDays: number;
}

/** Bütünlük olayı: ad/içerik taşımaz (yalnız evrak kimliği ve tür). */
export interface IntegrityFailure {
  readonly fileId: string;
  readonly kind: 'aead' | 'sha256' | 'length' | 'object_missing';
}

export interface FilesDeps {
  readonly db: FilesDb;
  readonly store: ObjectStore;
  readonly keyring: Pick<Keyring, 'activeDek' | 'dekByVersion'>;
  readonly jobs: FileJobProducer;
  readonly edaEnv: EdaEnv;
  readonly limits?: Partial<FilesLimits>;
  readonly now?: () => Date;
  readonly uuid: () => string;
  /** Tek kullanımlık indirme belirteci deposu (Valkey); yoksa belirteç üretimi 503. */
  readonly tokens?: DownloadTokenStore;
  /** `eda_file_integrity_failures_total` ve alarm bağlantı noktası (içeriksiz). */
  readonly onIntegrityFailure?: (info: IntegrityFailure) => void;
}

/** Nesne anahtarı `files` satırı değerlerinden TÜRETİLİR; istemciden anahtar alınmaz (033 §3.2). */
export function objectKeyOf(orgId: string, caseId: string | null, fileId: string): string {
  return caseId === null ? `org/${orgId}/inbox/${fileId}` : `org/${orgId}/case/${caseId}/${fileId}`;
}

/** Şifreli nesne uzunluğu: başlık + düz metin + segment başına etiket (033 §6.2 bütünlük). */
export function sealedLength(plainBytes: number): number {
  return HEADER_BYTES + plainBytes + TAG_BYTES * Math.ceil(plainBytes / SEGMENT_PLAIN_BYTES);
}
