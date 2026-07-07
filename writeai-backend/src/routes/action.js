const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { runAction, parseAiError } = require('../services/ai');
const {
  canPerformAction,
  incrementCount,
  logUsage,
  getMonthlyCount,
  getFreeLimit
} = require('../services/usage');

const VALID_ACTIONS = ['fix_grammar', 'rephrase', 'translate', 'summarize', 'explain', 'chat'];

router.post('/',
  authMiddleware,
  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'action' }),
  [
    body('action').isIn(VALID_ACTIONS),
    body('text').isString().isLength({ min: 1, max: 8000 }),
    body('extra').optional().isString().isLength({ max: 200 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { userId, plan } = req.user;
    const { action, text, extra } = req.body;

    const allowed = await canPerformAction(userId, plan);
    if (!allowed) {
      const count = await getMonthlyCount(userId);
      const limit = await getFreeLimit();
      return res.status(403).json({
        error: 'free_limit_reached',
        message: `You've used all ${limit} free actions this month.`,
        count,
        limit
      });
    }

    try {
      const { result, model, input_tokens, output_tokens } = await runAction(action, text, extra);

      incrementCount(userId).catch(console.error);
      logUsage(userId, action, model, input_tokens, output_tokens).catch(console.error);

      res.json({ result, model });
    } catch (err) {
      console.error('Action failed:', err);
      const parsed = parseAiError(err);
      res.status(parsed.status).json({
        error: parsed.code,
        message: parsed.message
      });
    }
  }
);

module.exports = router;
