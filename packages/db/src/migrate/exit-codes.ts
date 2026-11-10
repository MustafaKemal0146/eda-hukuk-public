// migrate / seed çıkış kodları (032 §6.6). Dağıtım hattı (072 §9) bu kodlara göre durur.
export const EXIT = {
  ok: 0,
  preflight: 10,
  advisoryLock: 11,
  checksum: 20,
  order: 21,
  sqlError: 30,
  lockRetriesExhausted: 31,
  seed: 40,
  seedVerify: 41,
  audit: 50,
  s3Bootstrap: 51,
  profileGate: 60,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Çalıştırıcının denetimli hatası: ileti Türkçe ve içeriksizdir (SQL metni, parametre, satır yok). */
export class MigrateError extends Error {
  override name = 'MigrateError';
  readonly code: ExitCode;

  constructor(code: ExitCode, message: string) {
    super(message);
    this.code = code;
  }
}
