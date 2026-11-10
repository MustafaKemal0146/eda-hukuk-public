// search_case_files (021 §4.7).
import { z } from 'zod';
import { FileDocType, type ToolContract } from './common.ts';

export const SearchCaseFilesInput = z
  .object({
    query: z.string().describe('Evrakta aranacak ifade.'),
    doc_types: z.array(FileDocType).nullable().describe('Evrak türleri veya null: tümü.'),
  })
  .strict();

export const searchCaseFiles: ToolContract<typeof SearchCaseFilesInput> = {
  name: 'search_case_files',
  description:
    'Sohbete bağlı dava dosyasının evrakında ve sohbet eklerinde arar; ilgili pasajları [K#] etiketiyle döndürür. Evrak içeriğine dair sorularda önce bunu kullan. Bağlı dosya veya ek yoksa hata döner.',
  inputSchema: SearchCaseFilesInput,
  serverRules: (i) => {
    const q = i.query.trim();
    return q.length < 2 || q.length > 300 ? 'query 2-300 karakter olmalı.' : null;
  },
};
