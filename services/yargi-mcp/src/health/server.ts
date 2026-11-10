// HTTP dinleyici: GET /health + isteğe bağlı rota (POST /mcp) ve zarif kapanış (021 §5.1: yeni istek
// kabul edilmez, uçuştakiler ≤ 30 sn tamamlanır). /health her zaman 200 döner (014 §6.1: bağımlılık
// kesintisi süreci sağlıksız yapmaz); P11.11: gövdeye valkey-cache PING sonucu eklenir, portala gidilmez.
import { createServer, type Server } from 'node:http';
import type { EdaLogger } from '@eda/observability/logger';
import type { NodeRoute } from '../http/mcp-route.ts';

export function startHealthServer(
  port: number,
  logger: EdaLogger,
  service: string,
  route?: NodeRoute,
  onStop?: () => Promise<void>,
  details?: () => Promise<Record<string, string>>,
): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      void (details ? details() : Promise.resolve({})).then((extra) => {
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ status: 'ok', ...extra }));
      });
      return;
    }
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    route(req, res)
      .then((handled) => {
        if (!handled) res.writeHead(404).end();
      })
      .catch(() => {
        logger.error({ event: 'process.fatal', service, scope: 'request' });
        if (!res.headersSent) res.writeHead(500).end();
        else res.end();
      });
  });
  server.listen(port, '0.0.0.0');
  logger.info({ event: 'server.started', service, port });
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) process.exit(1);
    stopping = true;
    logger.info({ event: 'shutdown.started', signal });
    server.close(() => {
      logger.info({ event: 'shutdown.completed' });
      process.exit(0);
    });
    server.closeIdleConnections();
    void onStop?.();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  return server;
}
