import { Router } from 'express';
import path from 'path';
import { TelegramBotService } from '../telegramBot.js';

const router = Router();

// GET /health - Public Health Check Endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// PWA Direct Routes
router.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(process.cwd(), 'static', 'manifest.json'));
});

router.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(process.cwd(), 'static', 'sw.js'));
});

router.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  const packageName = process.env.ANDROID_PACKAGE_NAME;
  const sha256Fingerprint = process.env.ANDROID_SHA256_FINGERPRINT;

  if (packageName && sha256Fingerprint) {
    const fingerprintsArray = sha256Fingerprint.split(',').map(f => f.trim());
    return res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: packageName,
          sha256_cert_fingerprints: fingerprintsArray
        }
      }
    ]);
  }

  res.sendFile(path.join(process.cwd(), 'static', '.well-known', 'assetlinks.json'));
});

// POST /webhook/telegram - Telegram Webhook endpoint
router.post('/webhook/telegram', async (req, res) => {
  try {
    const telegramSvc = new TelegramBotService();
    if (req.body && req.body.callback_query) {
      const result = await telegramSvc.processCallbackQuery(req.body.callback_query);
      res.json(result);
    } else if (req.body && req.body.message) {
      const result = await telegramSvc.handleIncomingMessage(req.body.message);
      res.json(result);
    } else {
      res.json({ status: 'ok', message: 'No action taken' });
    }
  } catch (err) {
    console.error('Error processing Telegram webhook:', err);
    res.status(500).json({ status: 'error', error: String(err) });
  }
});

export default router;
