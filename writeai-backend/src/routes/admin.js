const router = require('express').Router();
const { body, param, validationResult } = require('express-validator');
const panelAdminMiddleware = require('../middleware/panelAdmin');
const { login, updateProfile, changePassword } = require('../services/panelAuth');
const db = require('../db/postgres');
const { getSetting, updateSetting, loadAll } = require('../services/settings');
const { BUILTIN_MODELS } = require('../services/ai');
const { logAudit, getAuditLog } = require('../services/audit');
const { parseDays, getOverviewCharts, getAnalytics, getActivityFeed } = require('../services/analytics');
const { getSystemHealth } = require('../services/health');
const { FREE_LIMIT } = require('../services/usage');

function maskApiKey(key) {
  if (!key) return { configured: false, hint: '' };
  return { configured: true, hint: `••••${key.slice(-4)}` };
}

function sanitizeSettingsForClient(settings) {
  const keys = settings.api_keys || {};
  return {
    ...settings,
    api_keys: {
      openai: maskApiKey(keys.openai),
      gemini: maskApiKey(keys.gemini)
    }
  };
}

async function mergeApiKeys(current, incoming) {
  const merged = { ...current };
  for (const field of ['openai', 'gemini']) {
    const value = incoming[field];
    if (typeof value === 'string' && value.trim()) {
      merged[field] = value.trim();
    }
  }
  return merged;
}

function currentMonthYear() {
  return new Date().toISOString().slice(0, 7);
}

router.post('/auth/login',
  body('username').isString().trim().isLength({ min: 2, max: 100 }),
  body('password').isString().isLength({ min: 4, max: 128 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const result = await login(req.body.username, req.body.password);
    if (result.error) return res.status(401).json(result);
    res.json(result);
  }
);

router.get('/auth/me', panelAdminMiddleware, (req, res) => {
  res.json({ admin: req.panelAdmin });
});

router.get('/account', panelAdminMiddleware, (req, res) => {
  res.json({
    admin: {
      id: req.panelAdmin.id,
      username: req.panelAdmin.username,
      display_name: req.panelAdmin.display_name || req.panelAdmin.username,
      last_login_at: req.panelAdmin.last_login_at,
      created_at: req.panelAdmin.created_at
    },
    session_expires_in: process.env.ADMIN_SESSION_EXPIRES_IN || '8h'
  });
});

router.patch('/account',
  panelAdminMiddleware,
  body('display_name').optional().isString().trim().isLength({ min: 1, max: 100 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const admin = await updateProfile(req.panelAdmin.id, {
      display_name: req.body.display_name
    });

    await logAudit(req, 'profile.update', 'panel_admin', admin.id, { display_name: admin.display_name });
    res.json({ admin });
  }
);

router.post('/account/password',
  panelAdminMiddleware,
  body('current_password').isString().isLength({ min: 4, max: 128 }),
  body('new_password').isString().isLength({ min: 8, max: 128 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    if (req.body.current_password === req.body.new_password) {
      return res.status(400).json({
        error: 'same_password',
        message: 'New password must be different from current password.'
      });
    }

    const result = await changePassword(
      req.panelAdmin.id,
      req.body.current_password,
      req.body.new_password
    );

    if (result.error) return res.status(400).json(result);
    await logAudit(req, 'password.change', 'panel_admin', req.panelAdmin.id);
    res.json({ ok: true, message: 'Password updated successfully.' });
  }
);

router.use(panelAdminMiddleware);

router.get('/stats', async (req, res) => {
  const days = parseDays(req.query.days);
  const monthYear = currentMonthYear();

  const [users, subscriptions, usageMonth, usageByModel, usageByAction, recentUsers, charts] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE plan = 'pro')::int AS pro,
        COUNT(*) FILTER (WHERE plan = 'free')::int AS free,
        COUNT(*) FILTER (WHERE is_active IS NOT FALSE)::int AS active
      FROM users
    `),
    db.query(`
      SELECT subscription_status, COUNT(*)::int AS count
      FROM users
      WHERE stripe_subscription_id IS NOT NULL
      GROUP BY subscription_status
    `),
    db.query(`
      SELECT COALESCE(SUM(action_count), 0)::int AS total_actions
      FROM monthly_counts
      WHERE month_year = $1
    `, [monthYear]),
    db.query(`
      SELECT model, COUNT(*)::int AS count,
        COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM usage
      WHERE month_year = $1
      GROUP BY model
      ORDER BY count DESC
    `, [monthYear]),
    db.query(`
      SELECT action, COUNT(*)::int AS count
      FROM usage
      WHERE month_year = $1
      GROUP BY action
      ORDER BY count DESC
    `, [monthYear]),
    db.query(`
      SELECT COUNT(*)::int AS count FROM users
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `),
    getOverviewCharts(days)
  ]);

  res.json({
    users: users.rows[0],
    new_users_7d: recentUsers.rows[0].count,
    subscriptions: subscriptions.rows,
    usage: {
      month: monthYear,
      total_actions: usageMonth.rows[0].total_actions,
      by_model: usageByModel.rows,
      by_action: usageByAction.rows
    },
    charts,
    period_days: days
  });
});

router.get('/analytics', async (req, res) => {
  const days = parseDays(req.query.days);
  res.json(await getAnalytics(days));
});

router.get('/activity', async (req, res) => {
  res.json(await getActivityFeed(50));
});

router.get('/health', async (req, res) => {
  res.json(await getSystemHealth());
});

router.get('/audit', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  res.json(await getAuditLog(page, 50));
});

router.get('/export/users', async (req, res) => {
  const result = await db.query(
    `SELECT email, name, plan, role, is_active, subscription_status, created_at FROM users ORDER BY created_at DESC`
  );
  const header = 'email,name,plan,role,is_active,subscription_status,created_at\n';
  const rows = result.rows.map((r) =>
    [r.email, r.name, r.plan, r.role, r.is_active, r.subscription_status, r.created_at]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="writeai-users.csv"');
  res.send(header + rows);
  logAudit(req, 'export.users', 'users', null, { count: result.rows.length });
});

router.get('/export/usage', async (req, res) => {
  const month = req.query.month || currentMonthYear();
  const result = await db.query(
    `SELECT usr.email, us.action, us.model, us.input_tokens, us.output_tokens, us.created_at
     FROM usage us JOIN users usr ON usr.id = us.user_id
     WHERE us.month_year = $1 ORDER BY us.created_at DESC`,
    [month]
  );
  const header = 'email,action,model,input_tokens,output_tokens,created_at\n';
  const rows = result.rows.map((r) =>
    [r.email, r.action, r.model, r.input_tokens, r.output_tokens, r.created_at]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="writeai-usage-${month}.csv"`);
  res.send(header + rows);
  logAudit(req, 'export.usage', 'usage', month, { count: result.rows.length });
});

router.get('/users', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();
  const plan = req.query.plan || '';
  const monthYear = currentMonthYear();

  const conditions = ['1=1'];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
  }

  if (plan) {
    params.push(plan);
    conditions.push(`u.plan = $${params.length}`);
  }

  const where = conditions.join(' AND ');
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const monthIdx = params.length + 3;
  const queryParams = [...params, limit, offset, monthYear];

  const [rows, countResult] = await Promise.all([
    db.query(
      `SELECT u.id, u.email, u.name, u.avatar_url, u.plan, u.role, u.is_active,
              u.subscription_status, u.stripe_customer_id, u.created_at,
              COALESCE(mc.action_count, 0)::int AS actions_this_month
       FROM users u
       LEFT JOIN monthly_counts mc ON mc.user_id = u.id AND mc.month_year = $${monthIdx}
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      queryParams
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM users u WHERE ${where}`, params)
  ]);

  res.json({
    users: rows.rows,
    pagination: {
      page,
      limit,
      total: countResult.rows[0].total,
      pages: Math.ceil(countResult.rows[0].total / limit)
    }
  });
});

router.patch('/users/:id',
  param('id').isUUID(),
  body('plan').optional().isIn(['free', 'pro']),
  body('role').optional().isIn(['user', 'admin']),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const updates = [];
    const params = [];

    for (const field of ['plan', 'role', 'is_active']) {
      if (req.body[field] !== undefined) {
        params.push(req.body[field]);
        updates.push(`${field} = $${params.length}`);
      }
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'no_updates', message: 'No valid fields to update.' });
    }

    params.push(id);
    updates.push('updated_at = NOW()');

    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'not_found', message: 'User not found.' });
    }

    await logAudit(req, 'user.update', 'user', id, req.body);
    res.json({ user: result.rows[0] });
  }
);

router.delete('/users/:id', param('id').isUUID(), async (req, res) => {
  const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id, email', [req.params.id]);
  if (!result.rows.length) {
    return res.status(404).json({ error: 'not_found', message: 'User not found.' });
  }
  await logAudit(req, 'user.delete', 'user', req.params.id, { email: result.rows[0].email });
  res.json({ deleted: result.rows[0] });
});

router.get('/subscriptions', async (req, res) => {
  const result = await db.query(`
    SELECT id, email, name, plan, subscription_status,
           stripe_customer_id, stripe_subscription_id, updated_at
    FROM users
    WHERE stripe_customer_id IS NOT NULL OR plan = 'pro'
    ORDER BY updated_at DESC
    LIMIT 200
  `);

  res.json({ subscriptions: result.rows });
});

router.get('/usage', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const month = req.query.month || currentMonthYear();
  const search = (req.query.search || '').trim();
  const action = req.query.action || '';
  const model = req.query.model || '';

  const conditions = ['us.month_year = $1'];
  const params = [month];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`usr.email ILIKE $${params.length}`);
  }
  if (action) {
    params.push(action);
    conditions.push(`us.action = $${params.length}`);
  }
  if (model) {
    params.push(model);
    conditions.push(`us.model = $${params.length}`);
  }

  const where = conditions.join(' AND ');
  params.push(limit, offset);

  const [rows, countResult] = await Promise.all([
    db.query(
      `SELECT us.id, us.user_id, usr.email, us.action, us.model, us.input_tokens, us.output_tokens, us.created_at
       FROM usage us
       JOIN users usr ON usr.id = us.user_id
       WHERE ${where}
       ORDER BY us.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    db.query(
      `SELECT COUNT(*)::int AS total FROM usage us
       JOIN users usr ON usr.id = us.user_id WHERE ${where}`,
      params.slice(0, -2)
    )
  ]);

  res.json({
    usage: rows.rows,
    month,
    pagination: {
      page,
      limit,
      total: countResult.rows[0].total,
      pages: Math.ceil(countResult.rows[0].total / limit)
    }
  });
});

router.get('/settings', async (req, res) => {
  const settings = await loadAll();
  res.json({
    settings: sanitizeSettingsForClient(settings),
    builtin_models: BUILTIN_MODELS,
    free_limit_default: FREE_LIMIT
  });
});

router.patch('/settings',
  body('models').optional().isObject(),
  body('limits').optional().isObject(),
  body('api_keys').optional().isObject(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const updated = {};

    if (req.body.models) {
      const current = await getSetting('models');
      const next = { ...current, ...req.body.models };

      if (Array.isArray(req.body.models.custom_models)) {
        next.custom_models = req.body.models.custom_models
          .filter((m) => m.id && m.provider)
          .map((m) => ({
            id: String(m.id).trim(),
            provider: m.provider === 'gemini' ? 'gemini' : 'openai',
            label: String(m.label || m.id).trim()
          }));
      }

      updated.models = await updateSetting('models', next);
    }

    if (req.body.limits) {
      const current = await getSetting('limits');
      updated.limits = await updateSetting('limits', { ...current, ...req.body.limits });
    }

    if (req.body.api_keys) {
      const current = await getSetting('api_keys');
      updated.api_keys = await updateSetting('api_keys', await mergeApiKeys(current, req.body.api_keys));
    }

    const sanitized = {};
    if (updated.models) sanitized.models = updated.models;
    if (updated.limits) sanitized.limits = updated.limits;
    if (updated.api_keys) {
      sanitized.api_keys = sanitizeSettingsForClient({ api_keys: updated.api_keys }).api_keys;
      await logAudit(req, 'settings.api_keys', 'app_settings', 'api_keys');
    }

    if (updated.models) await logAudit(req, 'settings.models', 'app_settings', 'models', req.body.models);
    if (updated.limits) await logAudit(req, 'settings.limits', 'app_settings', 'limits', req.body.limits);

    res.json({ settings: sanitized });
  }
);

router.patch('/announcement',
  body('enabled').optional().isBoolean(),
  body('message').optional().isString().isLength({ max: 500 }),
  body('type').optional().isIn(['info', 'warning', 'success']),
  async (req, res) => {
    const current = await getSetting('announcement');
    const next = { ...current, ...req.body };
    const saved = await updateSetting('announcement', next);
    await logAudit(req, 'announcement.update', 'app_settings', 'announcement', next);
    res.json({ announcement: saved });
  }
);

router.get('/announcement', async (req, res) => {
  res.json({ announcement: await getSetting('announcement') });
});

module.exports = router;
