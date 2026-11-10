'use client';
// Tarayıcı tarafı CSP uyumu (061 §2.3): `unsafe-eval` olmadığından Zod'un `Function("")` yoklaması
// kapatılır. Modül yüklenirken bir kez çalışır; çizim üretmez.
import { disableZodJit } from '@eda/contracts/zod-jitless';

disableZodJit();

export function CspClientGuard(): null {
  return null;
}
