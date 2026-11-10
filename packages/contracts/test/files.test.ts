// @tk TK-04
// KK-P20-3 (033 §6, §8, §10): evrak DTO'ları güvenli alan kümesi, özel meta şemaları ve dosya işi yükü.
import { describe, expect, it } from 'vitest';
import {
  DownloadTokenResponse,
  FileContentQuery,
  FileDto,
  FileUploadFields,
} from '../src/api/files.ts';
import { CUSTODY_METADATA, parseCustodyMetadata } from '../src/custody.ts';
import { ExtractResult } from '../src/doc-engine/extract.ts';
import { CUSTODY_EVENTS } from '../src/enums.ts';
import { fileJobId } from '../src/jobs/files.ts';
import { JOBS, JobPayloadError, parseJobPayload } from '../src/queues.ts';

const ID = '01990000-0000-7000-8000-000000000001';
const dto = {
  id: ID,
  caseId: null,
  origin: 'chat_attachment',
  name: 'örnek dilekçe.pdf',
  fileType: 'pdf',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  status: 'uploaded',
  statusReason: null,
  scanned: false,
  pageCount: null,
  hasSearchable: false,
  hasClean: false,
  progressDone: null,
  progressTotal: null,
  mine: true,
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:00:00.000Z',
};

describe('KK-P20-3: FileDto yalnız güvenli alanlar', () => {
  it('geçerli DTO kabul edilir', () => {
    expect(FileDto.parse(dto).name).toBe('örnek dilekçe.pdf');
  });

  it('anahtar, sarılı anahtar ve nesne anahtarı sızdırılamaz (strict)', () => {
    for (const leak of ['wrappedFileKey', 'objectKey', 'keyVersion', 'uploadedBy', 'orgId']) {
      expect(FileDto.safeParse({ ...dto, [leak]: 'x' }).success).toBe(false);
    }
  });

  it('sha256 küçük harf onaltılık 64 karakter olmalı', () => {
    expect(FileDto.safeParse({ ...dto, sha256: 'A'.repeat(64) }).success).toBe(false);
    expect(FileDto.safeParse({ ...dto, sha256: 'a'.repeat(63) }).success).toBe(false);
  });
});

describe('KK-P20-3: yükleme alanları ve indirme', () => {
  it('batch metni boolean olur; bilinmeyen alan reddedilir', () => {
    expect(FileUploadFields.parse({ batch: 'true' }).batch).toBe(true);
    expect(FileUploadFields.safeParse({ orgId: ID }).success).toBe(false);
    expect(FileUploadFields.safeParse({ origin: 'case_upload' }).success).toBe(false);
  });

  it('indirme belirteci yanıtı göreli URL ve 43 karakterlik belirteç ister', () => {
    const dt = 'A'.repeat(43);
    expect(
      DownloadTokenResponse.safeParse({
        url: `/api/v1/files/${ID}/content?dt=${dt}`,
        expiresInSec: 60,
      }).success,
    ).toBe(true);
    expect(
      DownloadTokenResponse.safeParse({ url: `https://x.test/f?dt=${dt}`, expiresInSec: 60 })
        .success,
    ).toBe(false);
    expect(
      DownloadTokenResponse.safeParse({
        url: `/api/v1/files/${ID}/content?dt=${dt}&variant=searchable`,
        expiresInSec: 60,
      }).success,
    ).toBe(true);
    expect(
      DownloadTokenResponse.safeParse({
        url: `/api/v1/files/${ID}/content?dt=${dt}&variant=export`,
        expiresInSec: 60,
      }).success,
    ).toBe(false);
    expect(FileContentQuery.parse({}).variant).toBe('orig');
    expect(FileContentQuery.safeParse({ variant: 'export' }).success).toBe(false);
  });
});

describe('KK-P20-3 (KK-033-24): delil zinciri meta şemaları', () => {
  it('her olay için şema vardır', () => {
    expect(Object.keys(CUSTODY_METADATA).sort()).toEqual([...CUSTODY_EVENTS].sort());
  });

  it('şema dışı anahtar yazılamaz (dosya adı, imza adı)', () => {
    expect(() =>
      parseCustodyMetadata('upload', {
        size_bytes: 10,
        file_type: 'pdf',
        origin: 'case_upload',
        case_id: ID,
        original_name: 'ad.pdf',
      }),
    ).toThrow();
    expect(() =>
      parseCustodyMetadata('download', {
        variant: 'orig',
        range: null,
        via_token: true,
        signature: 'Eicar',
      }),
    ).toThrow();
    expect(
      parseCustodyMetadata('download', { variant: 'orig', range: null, via_token: true }),
    ).toEqual({ variant: 'orig', range: null, via_token: true });
  });
});

describe('KK-P20-3: file.scan iş kaydı', () => {
  it('yük yalnız kimlikler; fazla alan reddedilir', () => {
    const ok = { v: 1, orgId: ID, fileId: ID, userId: ID };
    expect(parseJobPayload('file.scan', ok)).toEqual(ok);
    expect(() => parseJobPayload('file.scan', { ...ok, name: 'ad.pdf' })).toThrow(JobPayloadError);
    expect(JOBS['file.scan'].queue).toBe('files-interactive');
    expect(JOBS['file.scan'].priority).toBe(1);
  });

  it('jobId ayracı __ ve iki nokta içermez', () => {
    const id = fileJobId('file.scan', ID, 1_760_000_000);
    expect(id).toBe(`file.scan__${ID}__1760000000`);
    expect(id).not.toContain(':');
  });
});

describe('KK-P21-dosya: file.extract işi ve ExtractResult (AS-0412)', () => {
  it('file.extract yükü yalnız kimlik; sohbet eki kuyruğu files-interactive', () => {
    const ok = { v: 1, orgId: ID, fileId: ID, userId: ID };
    expect(parseJobPayload('file.extract', ok)).toEqual(ok);
    expect(() => parseJobPayload('file.extract', { ...ok, text: 'x' })).toThrow(JobPayloadError);
    expect(JOBS['file.extract'].queue).toBe('files-interactive');
    expect(fileJobId('file.extract', ID, 1)).toBe(`file.extract__${ID}__1`);
  });

  it('ExtractResult strict: metinsiz PDF ok + hasTextLayer=false geçerlidir, fazla alan reddedilir', () => {
    const base = {
      jobId: ID,
      verdict: 'ok',
      rejectReason: null,
      fileType: 'pdf',
      pageCount: 2,
      hasTextLayer: false,
      text: '',
      textTruncated: false,
      pageOffsets: [],
      hiddenContent: { found: false, excludedFromText: false, items: [] },
      extractorVersion: 'eda-extract/0.0.0',
    };
    expect(ExtractResult.parse(base).hasTextLayer).toBe(false);
    expect(() => ExtractResult.parse({ ...base, sections: [] })).toThrow();
    expect(() => ExtractResult.parse({ ...base, fileType: 'udf' })).toThrow();
  });
});
