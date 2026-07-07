const router = require('express').Router();
const authMiddleware = require('../middleware/auth');
const { getMonthlyCount, getFreeLimit } = require('../services/usage');
const { getSetting } = require('../services/settings');
const { getModelConfig, resolveModelList } = require('../services/ai');

router.get('/announcement', async (req, res) => {
  const announcement = await getSetting('announcement');
  if (!announcement.enabled) return res.json({ announcement: null });
  res.json({ announcement: { message: announcement.message, type: announcement.type } });
});

router.get('/models', authMiddleware, async (req, res) => {
  const models = await getModelConfig();
  const list = resolveModelList(models).filter((m) => {
    if (m.provider === 'gemini') return models.gemini_enabled;
    return models.gpt_enabled;
  });

  res.json({
    primary: models.primary,
    fallback: models.fallback,
    models: list.map((m) => ({ id: m.id, label: m.label, provider: m.provider }))
  });
});

router.get('/me', authMiddleware, async (req, res) => {
  const { userId, email, name, avatar_url, plan, subscription_status, stripe_customer_id } = req.user;
  const count = await getMonthlyCount(userId);
  const limit = plan === 'pro' ? null : await getFreeLimit();

  res.json({
    email,
    name,
    avatar_url,
    plan,
    subscription_status,
    has_billing: !!stripe_customer_id,
    usage: { count, limit }
  });
});

module.exports = router;
