// Sohbet ekleri (053-02 §4.6; P21 ilk dilimi): yükleme (`origin=chat_attachment`), durum
// yoklaması ve istem kutusu durumu. Bu dilimde yalnız metin içeren PDF ve Word (.docx); taranmış
// (metinsiz) PDF açık uyarıyla reddedilir. Evrak adı ve metni URL'ye, tarayıcı deposuna, konsola
// yazılmaz; ek kimliği sunucuya kullanıcı mesajının `file` parçasıyla gider (K4; bayt yok).
import type { FileDtoValue } from '@eda/contracts/api/files';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { FileStatus } from '@eda/contracts/enums';
import type { FileUIPart } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError, documentsApi } from '../studio/documents-api.ts';
import { ATTACHMENT_URL_PREFIX } from './attachment-parts.ts';

export const ATTACHMENT_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/** Dosya seçicinin `accept` değeri (yalnız PDF ve Word). */
export const ATTACHMENT_ACCEPT = `.pdf,.docx,${ATTACHMENT_MIME.pdf},${ATTACHMENT_MIME.docx}`;

export const MAX_ATTACHMENTS = CONFIG_DEFAULTS['chat.maxAttachmentsPerMessage'];
/** Durum yoklama aralığı ve üst sınırı (istemci; sunucu sınırı `upload.timeoutSec`). */
export const POLL_MS = 1500;
export const POLL_MAX_MS = CONFIG_DEFAULTS['upload.timeoutSec'] * 1000;

export type AttachmentPhase = 'uploading' | 'processing' | 'ready' | 'error';
export type AttachmentErrorKey =
  | 'noText'
  | 'pageLimit'
  | 'encrypted'
  | 'failed'
  | 'quarantined'
  | 'tooLarge'
  | 'type'
  | 'disabled'
  | 'upload'
  | 'timeout'
  | 'tooMany';

export interface ChatAttachment {
  readonly localId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly fileId: string | null;
  readonly phase: AttachmentPhase;
  /** Sunucu durumu (çip rozeti); yükleme bitmeden `null`. */
  readonly status: FileStatus | null;
  readonly error: AttachmentErrorKey | null;
  /** Virüs taraması şu an yapılamıyor (`av_unavailable`): ek bekler, kullanılamaz. */
  readonly scanWaiting: boolean;
}

/** Yalnız uzantıya göre ön eleme; asıl tür denetimi sunucudadır (magic-byte). */
export function acceptsFile(name: string): boolean {
  const lower = name.toLocaleLowerCase('tr-TR');
  return lower.endsWith('.pdf') || lower.endsWith('.docx');
}

export function mimeOf(name: string): string {
  return name.toLocaleLowerCase('tr-TR').endsWith('.docx')
    ? ATTACHMENT_MIME.docx
    : ATTACHMENT_MIME.pdf;
}

/** Sunucu evrak durumundan çip evresi (033 §7.1 durum makinesi). */
export function phaseOf(file: Pick<FileDtoValue, 'status' | 'statusReason'>): {
  phase: AttachmentPhase;
  error: AttachmentErrorKey | null;
  scanWaiting: boolean;
} {
  switch (file.status) {
    case 'ready':
      return { phase: 'ready', error: null, scanWaiting: false };
    case 'ocr_skipped':
      return {
        phase: 'error',
        error: file.statusReason === 'page_limit' ? 'pageLimit' : 'noText',
        scanWaiting: false,
      };
    case 'failed':
      return {
        phase: 'error',
        error: file.statusReason === 'encrypted_pdf' ? 'encrypted' : 'failed',
        scanWaiting: false,
      };
    case 'quarantined':
      return { phase: 'error', error: 'quarantined', scanWaiting: false };
    default:
      return {
        phase: 'processing',
        error: null,
        scanWaiting: file.statusReason === 'av_unavailable',
      };
  }
}

export function uploadErrorKey(err: unknown): AttachmentErrorKey {
  if (!(err instanceof ApiClientError)) return 'upload';
  switch (err.code) {
    case 'FILE_TOO_LARGE':
      return 'tooLarge';
    case 'FILE_TYPE_NOT_ALLOWED':
      return 'type';
    case 'FILE_UPLOAD_DISABLED':
      return 'disabled';
    default:
      return 'upload';
  }
}

/** Gönderim kapalı mı: yüklenen veya işlenen ek varken soru gönderilmez (bu dilimde bekleme yok). */
export function sendBlocked(list: readonly ChatAttachment[]): boolean {
  return list.some((a) => a.phase === 'uploading' || a.phase === 'processing');
}

/** Gönderilecek ek parçaları: yalnız hazır olanlar (hatalı ek gönderilmez). */
export function readyParts(list: readonly ChatAttachment[]): FileUIPart[] {
  return list.flatMap((a) =>
    a.phase === 'ready' && a.fileId !== null
      ? [
          {
            type: 'file' as const,
            mediaType: a.mimeType,
            filename: a.name,
            url: `${ATTACHMENT_URL_PREFIX}${a.fileId}`,
          },
        ]
      : [],
  );
}

let seq = 0;
const nextLocalId = (): string => {
  seq += 1;
  return `ek-${seq}`;
};

export interface AttachmentsApi {
  upload: typeof documentsApi.files.upload;
  get: typeof documentsApi.files.get;
  remove: typeof documentsApi.files.remove;
}

/**
 * İstem kutusu ek durumu. `originId` verilirse (sohbet açıkken) ek yüklemede sohbete bağlanır; yoksa
 * sunucu ilk turda bağlar (K3).
 */
export function useChatAttachments(opts: { originId?: string; api?: AttachmentsApi } = {}): {
  items: readonly ChatAttachment[];
  add: (files: readonly File[]) => void;
  remove: (localId: string) => void;
  clear: () => void;
} {
  const api = opts.api ?? documentsApi.files;
  const [items, setItems] = useState<readonly ChatAttachment[]>([]);
  const alive = useRef(true);
  const removed = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const patch = useCallback((localId: string, next: Partial<ChatAttachment>) => {
    if (!alive.current) return;
    setItems((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...next } : a)));
  }, []);

  const track = useCallback(
    async (localId: string, file: File) => {
      let dto: FileDtoValue;
      try {
        const res = await api.upload({
          file,
          name: file.name,
          origin: 'chat_attachment',
          ...(opts.originId === undefined ? {} : { originId: opts.originId }),
        });
        dto = res.file;
      } catch (err) {
        patch(localId, { phase: 'error', error: uploadErrorKey(err) });
        return;
      }
      patch(localId, { fileId: dto.id, status: dto.status, ...phaseOf(dto) });
      const started = Date.now();
      while (alive.current && !removed.current.has(localId)) {
        const view = phaseOf(dto);
        if (view.phase !== 'processing') return;
        if (Date.now() - started > POLL_MAX_MS) {
          patch(localId, { phase: 'error', error: 'timeout' });
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        try {
          dto = await api.get(dto.id);
        } catch {
          continue; // geçici ağ hatası: yoklama sürer
        }
        patch(localId, { status: dto.status, ...phaseOf(dto) });
      }
    },
    [api, opts.originId, patch],
  );

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const add = useCallback(
    (files: readonly File[]) => {
      // Yan etki (yükleme) güncelleyicinin DIŞINDA: Strict Mode çift çağrısında çift yükleme olmaz.
      let count = itemsRef.current.length;
      const fresh: ChatAttachment[] = [];
      const uploads: [string, File][] = [];
      for (const file of files) {
        const localId = nextLocalId();
        const base = {
          localId,
          name: file.name,
          mimeType: mimeOf(file.name),
          fileId: null,
          status: null,
          scanWaiting: false,
        };
        if (count >= MAX_ATTACHMENTS) {
          fresh.push({ ...base, phase: 'error', error: 'tooMany' });
        } else if (!acceptsFile(file.name)) {
          fresh.push({ ...base, phase: 'error', error: 'type' });
        } else {
          fresh.push({ ...base, phase: 'uploading', error: null });
          uploads.push([localId, file]);
        }
        count += 1;
      }
      setItems((prev) => [...prev, ...fresh]);
      for (const [localId, file] of uploads) void track(localId, file);
    },
    [track],
  );

  const remove = useCallback(
    (localId: string) => {
      removed.current.add(localId);
      const target = itemsRef.current.find((a) => a.localId === localId);
      // Gönderilmemiş ek sunucudan da silinir (inbox'ta yetim kalmasın); hata önemsiz.
      if (target?.fileId) void api.remove(target.fileId).catch(() => undefined);
      setItems((prev) => prev.filter((a) => a.localId !== localId));
    },
    [api],
  );

  const clear = useCallback(() => setItems([]), []);
  return { items, add, remove, clear };
}
