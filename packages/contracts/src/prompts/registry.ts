// İstem kayıt defteri (024 §1): anahtar → metin + sürüm. Metinler tarayıcı paketine girmez.
import { text as chatCore } from './texts/chat.core.ts';
import { text as chatNoResults } from './texts/chat.no_results.ts';
import { text as chatTurnFrame } from './texts/chat.turn_frame.ts';

export const PROMPTS = {
  'chat.core': { version: 4, text: chatCore },
  'chat.turn_frame': { version: 1, text: chatTurnFrame },
  'chat.no_results': { version: 1, text: chatNoResults },
} as const;

export type PromptKey = keyof typeof PROMPTS;
