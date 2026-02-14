/**
 * WhatsApp Authentication with HTTP QR code server
 * Serves QR code as a web page for easy scanning from any device
 * Handles 515 stream errors by automatically reconnecting
 */
import fs from 'fs';
import http from 'http';
import pino from 'pino';
import QRCode from 'qrcode';

import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

const AUTH_DIR = './store/auth';
const PORT = 8899;

const logger = pino({
  level: 'warn',
});

let currentQR: string | null = null;
let authStatus: 'waiting' | 'success' | 'failed' = 'waiting';

// Simple HTTP server to display QR code
const server = http.createServer(async (req, res) => {
  if (req.url === '/qr.png' && currentQR) {
    const buffer = await QRCode.toBuffer(currentQR, { width: 400, margin: 2 });
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(buffer);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });

  if (authStatus === 'success') {
    res.end('<html><body style="text-align:center;font-family:sans-serif;padding:50px"><h1>Authenticated!</h1><p>WhatsApp is now connected. You can close this page.</p></body></html>');
    return;
  }

  if (!currentQR) {
    res.end('<html><body style="text-align:center;font-family:sans-serif;padding:50px"><h1>Waiting for QR code...</h1><script>setTimeout(()=>location.reload(),2000)</script></body></html>');
    return;
  }

  const svgQR = await QRCode.toString(currentQR, { type: 'svg', width: 400, margin: 2 });
  res.end(`
    <html>
    <body style="text-align:center;font-family:sans-serif;padding:20px">
      <h2>Scan with WhatsApp</h2>
      <p>1. Open WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device</p>
      <p>2. Point your camera at this QR code</p>
      <div style="display:inline-block;padding:20px;background:white;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1)">
        ${svgQR}
      </div>
      <p style="color:#888;margin-top:20px">QR code refreshes automatically</p>
      <script>setTimeout(()=>location.reload(),30000)</script>
    </body>
    </html>
  `);
});

async function authenticate(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  if (state.creds.registered) {
    console.log('Already authenticated with WhatsApp');
    process.exit(0);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nQR code server running at http://0.0.0.0:${PORT}`);
    console.log(`Open this URL in your browser to scan the QR code.\n`);
  });

  function startSocket(): void {
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: ['NanoClaw', 'Chrome', '1.0.0'],
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = qr;
        console.log('New QR code generated - refresh browser page if needed');
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as any)?.output?.statusCode;

        if (reason === DisconnectReason.loggedOut) {
          authStatus = 'failed';
          console.log('\nLogged out. Delete store/auth and try again.');
          server.close();
          process.exit(1);
        } else {
          console.log(`Connection closed (reason: ${reason}) - reconnecting...`);
          setTimeout(() => startSocket(), 2000);
          return;
        }
      }

      if (connection === 'open') {
        authStatus = 'success';
        console.log('\nSuccessfully authenticated with WhatsApp!');
        console.log('  Credentials saved to store/auth/');
        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 2000);
      }
    });

    sock.ev.on('creds.update', saveCreds);
  }

  startSocket();
}

authenticate().catch((err) => {
  console.error('Authentication failed:', err.message);
  server.close();
  process.exit(1);
});
