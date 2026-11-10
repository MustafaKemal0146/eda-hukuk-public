// @eda/db/files: dosya hattı DB adımları (worker). api kendi deposunu (repositories/files) kullanır.

export {
  type ExtractedText,
  type ExtractTarget,
  failExtract,
  finishExtract,
  loadExtractTarget,
  markOcrSkipped,
  noteDocEngineUnavailable,
} from './extract.ts';
export {
  failScan,
  finishScanClean,
  finishScanInfected,
  loadScanTarget,
  markScanning,
  noteScanUnavailable,
  type ScanTarget,
} from './scan.ts';
