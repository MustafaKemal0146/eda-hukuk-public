// `app.conversations`, `app.messages`, `app.message_sources` deposu (030 §7; P09). Her fonksiyon
// çağıranın `withTenant` işlemini alır; RLS satır erişimini kullanıcıya sınırlar (031). SQL yalnız burada.
import type { TenantTx } from '@eda/db';

export interface ConversationRow {
  readonly id: string;
  readonly title: string | null;
  readonly dataClass: 'public' | 'client' | 'case';
  readonly createdAt: Date;
}

export interface MessageRow {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly parts: unknown;
  readonly metadata: unknown;
  readonly llmParts: unknown;
}

export interface SourceRow {
  readonly refNo: number;
  readonly snapshot: unknown;
}

export async function insertConversation(
  tx: TenantTx,
  orgId: string,
  userId: string,
  id: string,
): Promise<void> {
  await tx.query(`INSERT INTO app.conversations (id, org_id, user_id) VALUES ($1, $2, $3)`, [
    id,
    orgId,
    userId,
  ]);
}

export async function listConversations(
  tx: TenantTx,
  orgId: string,
  userId: string,
  limit: number,
): Promise<{ id: string; title: string | null; createdAt: Date }[]> {
  const r = await tx.query(
    `SELECT c.id, c.title, c.created_at
       FROM app.conversations c
      WHERE c.org_id = $1 AND c.user_id = $2 AND c.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM app.messages m WHERE m.org_id = c.org_id AND m.conversation_id = c.id)
      ORDER BY c.last_message_at DESC, c.id DESC
      LIMIT $3`,
    [orgId, userId, limit],
  );
  return r.rows.map((x) => {
    const row = x as Record<string, unknown>;
    return {
      id: String(row.id),
      title: (row.title as string | null) ?? null,
      createdAt: row.created_at as Date,
    };
  });
}

export async function getConversation(
  tx: TenantTx,
  orgId: string,
  userId: string,
  id: string,
  lock = false,
): Promise<ConversationRow | null> {
  const r = await tx.query(
    `SELECT c.id, c.title, c.data_class, c.created_at
       FROM app.conversations c
      WHERE c.org_id = $1 AND c.user_id = $2 AND c.id = $3
      ${lock ? 'FOR UPDATE OF c' : ''}`,
    [orgId, userId, id],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    title: (row.title as string | null) ?? null,
    dataClass: row.data_class as ConversationRow['dataClass'],
    createdAt: row.created_at as Date,
  };
}

/**
 * Sohbeti siler (041 #23): yalnız sahibi. Mesajlar, kaynaklar ve atıflar `ON DELETE cascade` ile gider.
 * Dosyaya bağlı sohbet, dosya yasal saklamadaysa silinmez (`CHAT_DELETE_BLOCKED`, `legal_hold`).
 */
export async function deleteConversation(
  tx: TenantTx,
  orgId: string,
  userId: string,
  id: string,
): Promise<'deleted' | 'not_found' | 'legal_hold'> {
  const found = await tx.query(
    `SELECT COALESCE(k.legal_hold, false) AS legal_hold
       FROM app.conversations c
       LEFT JOIN app.cases k ON k.org_id = c.org_id AND k.id = c.case_id
      WHERE c.org_id = $1 AND c.user_id = $2 AND c.id = $3
      FOR UPDATE OF c`,
    [orgId, userId, id],
  );
  const row = found.rows[0] as Record<string, unknown> | undefined;
  if (!row) return 'not_found';
  if (row.legal_hold === true) return 'legal_hold';
  await tx.query(`DELETE FROM app.conversations WHERE org_id = $1 AND user_id = $2 AND id = $3`, [
    orgId,
    userId,
    id,
  ]);
  return 'deleted';
}

export async function listMessages(
  tx: TenantTx,
  orgId: string,
  conversationId: string,
): Promise<MessageRow[]> {
  const r = await tx.query(
    `SELECT id, role, parts, metadata, llm_parts
       FROM app.messages
      WHERE org_id = $1 AND conversation_id = $2 AND in_transcript
      ORDER BY created_at, id`,
    [orgId, conversationId],
  );
  return r.rows.map((x) => {
    const row = x as Record<string, unknown>;
    return {
      id: String(row.id),
      role: row.role as MessageRow['role'],
      parts: row.parts,
      metadata: row.metadata,
      llmParts: row.llm_parts,
    };
  });
}

export interface InsertMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly status: 'complete' | 'stopped' | 'error';
  readonly userId: string | null;
  readonly parts: unknown;
  readonly metadata: unknown;
  readonly llmParts: unknown | null;
  readonly modelAlias: string | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly region: string | null;
  readonly dataClass: string | null;
  readonly thinking: string | null;
  readonly requestId: string | null;
  readonly replyToMessageId: string | null;
}

export async function insertMessage(
  tx: TenantTx,
  orgId: string,
  conversationId: string,
  m: InsertMessage,
): Promise<void> {
  await tx.query(
    `INSERT INTO app.messages
       (id, org_id, conversation_id, role, status, user_id, parts, metadata, llm_parts,
        model_alias, provider_id, model_id, region, data_class, thinking, request_id,
        reply_to_message_id, completed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::json,
             $10, $11, $12, $13, $14, $15, $16, $17, clock_timestamp(), clock_timestamp())`,
    [
      m.id,
      orgId,
      conversationId,
      m.role,
      m.status,
      m.userId,
      JSON.stringify(m.parts),
      JSON.stringify(m.metadata ?? {}),
      m.llmParts === null ? null : JSON.stringify(m.llmParts),
      m.modelAlias,
      m.providerId,
      m.modelId,
      m.region,
      m.dataClass,
      m.thinking,
      m.requestId,
      m.replyToMessageId,
    ],
  );
}

export interface UpdatedAssistantMessage {
  readonly parts: unknown;
  readonly metadata: unknown;
  readonly llmParts: unknown;
  readonly status: 'complete' | 'stopped' | 'error';
  readonly modelAlias: string;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly region: string | null;
  readonly dataClass: string | null;
  readonly thinking: string | null;
  readonly requestId: string;
}

/**
 * Yeniden üretimde asistan yanıtı YERİNDE güncellenir ("üzerine yazılır"). Satır kimliği korunur
 * çünkü `app.message_sources` yalnız SELECT/INSERT yetkilidir: `[K#]` etiketi bir kez verilir,
 * değişmez ve kaynak satırları mesaja bağlı kalır (031). `updated_at` tetikleyiciyle güncellenir.
 */
export async function updateAssistantMessage(
  tx: TenantTx,
  orgId: string,
  conversationId: string,
  messageId: string,
  m: UpdatedAssistantMessage,
): Promise<void> {
  await tx.query(
    `UPDATE app.messages
        SET parts = $4::jsonb, metadata = $5::jsonb, llm_parts = $6::json,
            status = $7, model_alias = $8, provider_id = $9, model_id = $10, region = $11,
            data_class = $12, thinking = $13, request_id = $14,
            error_code = NULL, completed_at = clock_timestamp()
      WHERE org_id = $1 AND conversation_id = $2 AND id = $3 AND role = 'assistant'`,
    [
      orgId,
      conversationId,
      messageId,
      JSON.stringify(m.parts),
      JSON.stringify(m.metadata ?? {}),
      JSON.stringify(m.llmParts),
      m.status,
      m.modelAlias,
      m.providerId,
      m.modelId,
      m.region,
      m.dataClass,
      m.thinking,
      m.requestId,
    ],
  );
}

/**
 * Mesaj düzenleme (yeniden gönderme): hedef KULLANICI mesajı ve transkript sırasında ondan sonra
 * gelen tüm mesajlar transkriptten düşürülür (`in_transcript = false`; satır silinmez, geçmiş
 * yeniden üretim/yarım tur kaydıyla aynı yaklaşım). Kaynak satırları (`[K#]` etiket defteri)
 * dokunulmaz. Dönen sayı etkilenen satır sayısıdır; hedef bu sohbette/transkriptte değilse 0.
 */
export async function retireMessagesFrom(
  tx: TenantTx,
  orgId: string,
  conversationId: string,
  messageId: string,
): Promise<number> {
  const r = await tx.query(
    `UPDATE app.messages m
        SET in_transcript = false
       FROM (SELECT created_at, id FROM app.messages
              WHERE org_id = $1 AND conversation_id = $2 AND id = $3
                AND role = 'user' AND in_transcript) t
      WHERE m.org_id = $1 AND m.conversation_id = $2 AND m.in_transcript
        AND (m.created_at, m.id) >= (t.created_at, t.id)`,
    [orgId, conversationId, messageId],
  );
  return r.rowCount ?? 0;
}

export async function touchConversation(
  tx: TenantTx,
  orgId: string,
  id: string,
  v: { title: string | null; titleFold: string | null; nextSourceLabel: number; alias: string },
): Promise<void> {
  await tx.query(
    `UPDATE app.conversations
        SET title = COALESCE(title, $3),
            title_fold = COALESCE(title_fold, $4),
            next_source_label = GREATEST(next_source_label, $5::int),
            last_model_alias = $6,
            last_message_at = now()
      WHERE org_id = $1 AND id = $2`,
    [orgId, id, v.title, v.titleFold, v.nextSourceLabel, v.alias],
  );
}

export async function listSources(
  tx: TenantTx,
  orgId: string,
  conversationId: string,
): Promise<SourceRow[]> {
  const r = await tx.query(
    `SELECT ref_no, kunye_snapshot
       FROM app.message_sources
      WHERE org_id = $1 AND conversation_id = $2
      ORDER BY ref_no`,
    [orgId, conversationId],
  );
  return r.rows.map((x) => {
    const row = x as Record<string, unknown>;
    return { refNo: Number(row.ref_no), snapshot: row.kunye_snapshot };
  });
}

export async function insertSource(
  tx: TenantTx,
  orgId: string,
  conversationId: string,
  messageId: string | null,
  s: { refNo: number; kind: string; sourceKey: string; snapshot: unknown },
): Promise<void> {
  // Köken: sohbet eki (`case_file`) kullanıcı evrakıdır (`user`, P21 K6); diğerleri canlı kaynak.
  await tx.query(
    `INSERT INTO app.message_sources
       (org_id, conversation_id, message_id, ref_no, source_kind, origin, source_key, kunye_snapshot)
     VALUES ($1, $2, $3, $4, $5, $8, $6, $7::jsonb)
     ON CONFLICT (org_id, conversation_id, source_key) DO NOTHING`,
    [
      orgId,
      conversationId,
      messageId,
      s.refNo,
      s.kind,
      s.sourceKey,
      JSON.stringify(s.snapshot),
      s.kind === 'case_file' ? 'user' : 'live',
    ],
  );
}
