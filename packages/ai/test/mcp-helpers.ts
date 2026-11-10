// yargi-mcp'yi replay kipinde alt süreç olarak başlatır (portala çıkmaz; kayıtlı resmî portal yanıtları).
// Kova, kesici ve önbellek gerçek valkey-cache'tedir (eda_mcp; P11.12). Anahtar çifti test başına
// üretilir; Valkey parolası yalnız dosya yoludur.
import { type ChildProcess, spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_NO_PROXY } from '@eda/contracts/config/env';

export type Ed25519Pair = { privateKeyPem: string; publicKeyPem: string };

export function ed25519Pair(): Ed25519Pair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

export type YargiMcpProcess = { url: string; stop: () => Promise<void> };

const MAIN = fileURLToPath(new URL('../../../services/yargi-mcp/src/main.ts', import.meta.url));

export async function startYargiMcp(
  publicKeyPem: string,
  valkey: { url: string; mcpPasswordFile: string },
): Promise<YargiMcpProcess> {
  const dir = mkdtempSync(join(tmpdir(), 'eda-yargi-'));
  const pub = join(dir, 'pub.pem');
  writeFileSync(pub, publicKeyPem);
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, [MAIN], {
    env: {
      EDA_ENV: 'test',
      LOG_LEVEL: 'fatal',
      MCP_PORT: String(port),
      INTERNAL_JWT_PUBLIC_KEY_FILE: pub,
      INTERNAL_JWT_AUDIENCE: 'yargi-mcp',
      VALKEY_CACHE_URL: valkey.url,
      VALKEY_CACHE_USERNAME: 'eda_mcp',
      VALKEY_CACHE_PASSWORD_FILE: valkey.mcpPasswordFile,
      YARGI_SOURCES_ENABLED: 'bedesten,mevzuat',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      HTTP_PROXY: 'http://127.0.0.1:9',
      NO_PROXY: CANONICAL_NO_PROXY,
      NODE_USE_ENV_PROXY: '1',
      SOURCE_USER_AGENT: 'EDA-Hukuk-Kaynak-Istemcisi/1.0 (+https://eda.localhost/guvenlik)',
      SOURCE_FIXTURE_MODE: 'replay',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (b: Buffer) => {
    stderr += b.toString();
  });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`yargi-mcp başlamadı: ${stderr}`);
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) break;
    } catch {
      // henüz dinlemiyor
    }
    if (Date.now() > deadline) throw new Error(`yargi-mcp sağlık zaman aşımı: ${stderr}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url: `${url}/mcp`,
    stop: () =>
      new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}
