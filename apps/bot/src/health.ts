import { createServer, type Server } from 'node:http';

export interface HealthChecks {
  live(): boolean;
  ready(): Promise<boolean>;
}

export function startHealthServer(port: number, checks: HealthChecks): Server {
  const server = createServer(async (req, res) => {
    let ok = false;
    if (req.url === '/livez') ok = checks.live();
    else if (req.url === '/readyz') ok = await checks.ready().catch(() => false);
    else {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain' }).end(ok ? 'ok' : 'not ok');
  });
  server.listen(port);
  return server;
}
