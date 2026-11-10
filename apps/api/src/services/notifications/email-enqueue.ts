// `emailEnqueue` (045 §6.1–§6.2): parametreleri şablon şemasıyla (`.strict()`) doğrular, sırrı
// teslimat kimliğine bağlı AAD ile mühürler (`sealJobParams`), outbox satırını
// `app.email_enqueue` ile alıcı kullanıcı bağlamında (`withUserScope`) açar ve commit sonrası
// `email.send` işini ekler. `dedupe_key` çakışmasında hiçbir şey eklenmez. Hono bilmez.
import { sealJobParams } from '@eda/crypto';
import type { UserTx } from '@eda/db';
import { enqueueEmailRow } from '@eda/db/email';
import {
  type CatalogCode,
  parseTemplateParams,
  TEMPLATES,
  type TemplateParams,
} from '@eda/email/catalog';
import type { EmailProducer } from '../../queue/producer.ts';

export interface EmailEnqueueDeps {
  readonly withUserScope: <T>(
    ctx: { userId: string },
    fn: (tx: UserTx) => Promise<T>,
  ) => Promise<T>;
  readonly producer: EmailProducer;
  readonly kek: Uint8Array;
  readonly newId: () => string;
}

export interface EmailEnqueueInput<C extends CatalogCode> {
  readonly template: C;
  readonly userId: string;
  readonly orgId?: string | null;
  /**
   * Davet e-postası (P04b): `userId` davet eden, alıcı adresi worker'da
   * davet tablosunun e-posta kolonundan'den çözülür. Kimlik mühürlü sırdır; `dedupe_key`'e yazılmaz.
   */
  readonly invitationId?: string | null;
  readonly dedupeKey: string;
  readonly params: TemplateParams<C>;
  /** Mühürlenecek sır (ör. bağlantı belirteci); şablonun `secrets` listesiyle eşleşmelidir. */
  readonly secret?: { readonly token: string };
  readonly expiresAt: Date;
  readonly requestId?: string | undefined;
}

export class EmailSecretMismatchError extends Error {
  override name = 'EmailSecretMismatchError';
}

/** Teslimat kimliği (yeni satır) veya `null` (aynı `dedupe_key` zaten var). */
export async function emailEnqueue<C extends CatalogCode>(
  deps: EmailEnqueueDeps,
  input: EmailEnqueueInput<C>,
): Promise<string | null> {
  const meta = TEMPLATES[input.template];
  const params = parseTemplateParams(input.template, input.params);
  const needsSecret = meta.secrets.length > 0;
  if (needsSecret !== (input.secret !== undefined)) {
    throw new EmailSecretMismatchError(`şablon sır sözleşmesi uyuşmuyor: ${input.template}`);
  }
  const id = deps.newId();
  const sealed =
    input.secret === undefined
      ? null
      : sealJobParams(
          deps.kek,
          { deliveryId: id, template: input.template, userId: input.userId },
          { token: input.secret.token },
        );
  return deps.withUserScope({ userId: input.userId }, async (tx) => {
    const delivered = await enqueueEmailRow(tx, {
      id,
      kind: meta.kind,
      template: input.template,
      templateVersion: meta.version,
      class: meta.class,
      userId: input.userId,
      orgId: input.orgId ?? null,
      invitationId: input.invitationId ?? null,
      dedupeKey: input.dedupeKey,
      params,
      sealed,
      expiresAt: input.expiresAt,
    });
    if (delivered !== null) {
      tx.afterCommit(() =>
        deps.producer.addEmailSend({
          deliveryId: delivered,
          class: meta.class,
          template: input.template,
          requestId: input.requestId,
        }),
      );
    }
    return delivered;
  });
}

/** `dedupe_key` biçimleri (P04a.7): dakika/saat kovası kimlik + zaman. */
export const dedupeKeys = {
  verifyEmail: (userId: string, now: Date) =>
    `verify_email:${userId}:${Math.floor(now.getTime() / 60_000)}`,
  passwordReset: (userId: string, now: Date) =>
    `password_reset:${userId}:${Math.floor(now.getTime() / 60_000)}`,
  registrationAttempt: (userId: string, now: Date) =>
    `registration_attempt:${userId}:${Math.floor(now.getTime() / 3_600_000)}`,
  passwordChanged: (userId: string, now: Date) => `password_changed:${userId}:${now.getTime()}`,
  applicationReceived: (userId: string, submittedAt: Date) =>
    `application_received:${userId}:${submittedAt.getTime()}`,
  /** Davet: kimliğin özeti (belirteç `dedupe_key`'e yazılmaz). */
  invitation: (invitationDigest: string) => `invitation:${invitationDigest}`,
  factorChanged: (userId: string, factor: string, action: string, now: Date) =>
    `factor_changed:${userId}:${factor}:${action}:${now.getTime()}`,
};
