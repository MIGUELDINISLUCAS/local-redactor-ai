import { Router } from 'express';
import { activateLicense, deactivateLicense, fullStatus } from '../core/license';

const router = Router();

// GET /api/status — combined trial + license state for the popup.
router.get('/status', (_req, res) => {
  res.json(fullStatus());
});

// POST /api/license/activate — validate, machine-bind (via the license server
// for v2 purchase keys), and persist a license key.
router.post('/license/activate', async (req, res) => {
  const { key } = req.body ?? {};
  if (!key || typeof key !== 'string') {
    res.status(400).json({ ok: false, error: 'missing-key' });
    return;
  }
  const result = await activateLicense(key);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

// DELETE /api/license — remove the stored license (for transferring machines).
router.delete('/license', (_req, res) => {
  deactivateLicense();
  res.json({ ok: true });
});

export default router;
