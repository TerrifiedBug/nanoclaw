import crypto from 'crypto';
import http from 'http';

import { WEBHOOK_PORT, WEBHOOK_SECRET } from './config.js';
import { logger } from './logger.js';

export interface WebhookDependencies {
  getMainChannelJid: () => string | null;
  insertMessage: (chatJid: string, messageId: string, source: string, text: string) => void;
}

const MAX_BODY_SIZE = 65536; // 64KB

export function startWebhookServer(deps: WebhookDependencies): http.Server {
  const server = http.createServer((req, res) => {
    // Only accept POST /webhook
    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Verify Bearer token
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${WEBHOOK_SECRET}`) {
      logger.warn({ ip: req.socket.remoteAddress }, 'Webhook auth rejected');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Read body with size limit
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (res.writableEnded) return;

      let payload: { source?: string; text?: string };
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const source = payload.source || 'webhook';
      const text = payload.text;

      if (!text || typeof text !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "text" field' }));
        return;
      }

      const mainJid = deps.getMainChannelJid();
      if (!mainJid) {
        logger.error('Webhook received but no main channel registered');
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No main channel configured' }));
        return;
      }

      const messageId = `wh-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      deps.insertMessage(mainJid, messageId, source, text);

      logger.info({ source, messageId, length: text.length }, 'Webhook message injected');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, messageId }));
    });
  });

  server.listen(WEBHOOK_PORT, () => {
    logger.info({ port: WEBHOOK_PORT }, 'Webhook server listening');
  });

  return server;
}
