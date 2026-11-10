// Sohbet için anahtarı çözer (#54 BYOK): kullanıcının seçtiği kaynaktan. Anahtar yoksa eksik kaynak
// döner; çağıran "büro/baroya tanımlanmış API key yok" hatasını verir. Platform anahtarına SESSİZ DÜŞME
// yoktur: yalnız `deps.platform` açıkça verilmişse (PLATFORM_AI_KEY_FALLBACK=true) eksik kaynak
// yerine (sağlayıcı açık ve anahtar tanımlıysa) kaynağı `platform` olan ortak anahtar döner; sınırı çağıranın kapısı uygular.
// Dönen düz metin çağıran tarafından yalnız istek süresince tutulur; tamponlar sıfırlanır.
import { decryptField, unwrapDek, wipe } from '@eda/crypto';
import * as repo from '../../repositories/ai-keys/ai-keys.ts';
import { deriveUserKey, orgKeyContext, userKeyContext } from './crypto.ts';
import type { AiKeysDeps, AiKeysResolveActor, ResolvedKey } from './types.ts';

export async function resolveKey(deps: AiKeysDeps, a: AiKeysResolveActor): Promise<ResolvedKey> {
  const r = await resolveOwnOrOrg(deps, a);
  if ('missing' in r && deps.platform != null) {
    const p = await deps.platform.get();
    if (p.enabled && p.apiKey !== null) return { apiKey: p.apiKey, source: 'platform' };
  }
  return r;
}

async function resolveOwnOrOrg(deps: AiKeysDeps, a: AiKeysResolveActor): Promise<ResolvedKey> {
  const own = await deps.db.withUserScope({ userId: a.userId }, (tx) =>
    repo.readUserSlot(tx, a.userId),
  );
  if (own.source === 'own') {
    if (own.enc === null || own.version === null) return { missing: 'own' };
    const key = deriveUserKey(deps.kek.kek, a.userId);
    try {
      return {
        apiKey: decryptField(key, userKeyContext(a.userId, own.version), own.enc),
        source: 'own',
      };
    } finally {
      wipe(key);
    }
  }
  return deps.db.withTenant(
    { orgId: a.orgId, userId: a.userId },
    async (tx): Promise<ResolvedKey> => {
      const slot = await repo.readOrgSlot(tx, a.orgId);
      if (slot.enc === null || slot.version === null) return { missing: 'org' };
      // Alan, yazıldığı DEK sürümüyle çözülür (rotasyondan sonra etkin DEK farklı olabilir).
      const dek = await repo.readDekVersion(tx, a.orgId, slot.version);
      if (dek === null) return { missing: 'org' };
      const raw = unwrapDek(
        deps.kek.kek,
        { orgId: a.orgId, dekVersion: dek.keyVersion, kekVersion: dek.kekVersion },
        dek.wrapped,
      );
      try {
        return {
          apiKey: decryptField(raw, orgKeyContext(a.orgId, slot.version), slot.enc),
          source: 'org',
        };
      } finally {
        wipe(raw);
      }
    },
  );
}
