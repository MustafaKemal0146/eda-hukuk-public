// Yapay zekâ API anahtarı verisi (#54 BYOK): sözleşmeli istemci (aynı origin). Anahtar yalnız istek
// gövdesinde gider; hiçbir yerde saklanmaz, loglanmaz veya URL'ye yazılmaz. Server Action/Route
// Handler yok.
import { ApiClientError, createDocumentsClient } from '@eda/api-client/endpoints/documents';
import { guardedFetch } from '../../lib/session-guard.ts';
import type { AiKeySource, AiKeysState } from './ai-keys-model.ts';

const client = createDocumentsClient({ fetch: guardedFetch });

export { ApiClientError };

export const loadAiKeys = (): Promise<AiKeysState> => client.aiKeys.status();
export const saveOrgKey = (apiKey: string): Promise<AiKeysState> =>
  client.aiKeys.setOrg({ apiKey });
export const removeOrgKey = (): Promise<AiKeysState> => client.aiKeys.removeOrg();
export const saveOwnKey = (apiKey: string): Promise<AiKeysState> =>
  client.aiKeys.setOwn({ apiKey });
export const removeOwnKey = (): Promise<AiKeysState> => client.aiKeys.removeOwn();
export const chooseKeySource = (source: AiKeySource): Promise<AiKeysState> =>
  client.aiKeys.setSource({ source });
