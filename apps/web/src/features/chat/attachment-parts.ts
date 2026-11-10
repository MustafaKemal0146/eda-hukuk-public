// Kullanıcı mesajındaki ek parçası (P21 K4; ilk dilim ): `{ type: 'file', url: 'eda-file:<id>' }`,
// bayt yok. Saf modül: istek gövdesi derleyici ve mesaj görünümü kullanır.

/** Sunucuyla aynı önek (`apps/api/src/chat/turn.ts` `ATTACHMENT_URL_PREFIX`). */
export const ATTACHMENT_URL_PREFIX = 'eda-file:';

/** Mesaj parçalarındaki ek kimlikleri (istek gövdesi `attachments`). */
export function attachmentIdsOf(
  parts: readonly { type: string; url?: string | undefined }[],
): string[] {
  return parts.flatMap((p) =>
    p.type === 'file' && typeof p.url === 'string' && p.url.startsWith(ATTACHMENT_URL_PREFIX)
      ? [p.url.slice(ATTACHMENT_URL_PREFIX.length)]
      : [],
  );
}

/** Mesajdaki ek adları (yalnız kullanıcının kendi görünümünde çizilir). */
export function attachmentNamesOf(
  parts: readonly { type: string; url?: string | undefined; filename?: string | undefined }[],
): string[] {
  return parts.flatMap((p) =>
    p.type === 'file' && typeof p.url === 'string' && p.url.startsWith(ATTACHMENT_URL_PREFIX)
      ? [p.filename ?? '']
      : [],
  );
}
