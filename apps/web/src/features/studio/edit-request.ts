// "Sohbetle düzenle" istek modeli (saf): hazır komut kimlikleri, istek kutusuna ekleme ve sohbete
// gidecek ilk mesajın kurulması. Metinler tr.json'dadır; burada yalnız birleştirme kuralı vardır.
export const EDIT_COMMANDS = [
  'formal',
  'shorten',
  'grounds',
  'petitionFormat',
  'markPlaceholders',
  'proofread',
] as const;
export type EditCommand = (typeof EDIT_COMMANDS)[number];

/** Çip metnini istek kutusuna ekler: boşsa olduğu gibi, doluysa yeni satırda; aynı metin iki kez eklenmez. */
export function appendCommand(current: string, commandText: string): string {
  const base = current.trimEnd();
  if (base === '') return commandText;
  if (base.split('\n').some((line) => line.trim() === commandText.trim())) return base;
  return `${base}\n${commandText}`;
}

export type EditPromptParts = {
  /** Katalog girişi (`studio.export.chatPrompt`); "İsteğim: " ile biter. */
  prompt: string;
  request: string;
  title: string;
  body: string;
};

/** Sohbet ilk mesajı: yönerge + istek, başlık, belge gövdesi. İstek boşsa yalnız yönerge kalır. */
export function buildEditPrompt({ prompt, request, title, body }: EditPromptParts): string {
  const head = request.trim() === '' ? prompt.trim() : `${prompt}${request.trim()}`;
  return `${head}\n\n${title}\n\n${body}`;
}
