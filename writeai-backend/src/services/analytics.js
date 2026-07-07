const db = require('../db/postgres');

const MODEL_COSTS = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-flash-lite': { input: 0.075, output: 0.30 },
  'gemini-2.5-pro': { input: 1.25, output: 5.0 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 }
};

const PRO_PRICE = 7;

function estimateTokenCost(model, inputTokens, outputTokens) {
  const rates = MODEL_COSTS[model] || MODEL_COSTS['gpt-4o-mini'];
  return ((inputTokens || 0) * rates.input + (outputTokens || 0) * rates.output) / 1_000_000;
}

function parseDays(query) {
  const d = parseInt(query, 10);
  if ([7, 14, 30, 90].includes(d)) return d;
  return 30;
}

async function getDailyActions(days = 30) {
  const result = await db.query(
    `SELECT DATE(created_at) AS day, COUNT(*)::int AS count
     FROM usage
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY DATE(created_at)
     ORDER BY day ASC`,
    [days]
  );
  return result.rows;
}

async function getOverviewCharts(days = 30) {
  const monthYear = new Date().toISOString().slice(0, 7);

  const [daily, planSplit, byAction, prevMonthActions, sparkline] = await Promise.all([
    getDailyActions(days),
    db.query(`SELECT plan, COUNT(*)::int AS count FROM users GROUP BY plan`),
    db.query(
      `SELECT action, COUNT(*)::int AS count FROM usage
       WHERE created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY action ORDER BY count DESC`,
      [days]
    ),
    db.query(
      `SELECT COALESCE(SUM(action_count), 0)::int AS count FROM monthly_counts
       WHERE month_year = TO_CHAR(NOW() - INTERVAL '1 month', 'YYYY-MM')`
    ),
    db.query(
      `SELECT DATE(created_at) AS day, COUNT(*)::int AS count FROM usage
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(created_at) ORDER BY day ASC`
    )
  ]);

  const currentMonth = await db.query(
    `SELECT COALESCE(SUM(action_count), 0)::int AS count FROM monthly_counts WHERE month_year = $1`,
    [monthYear]
  );

  return {
    daily_actions: daily,
    plan_split: planSplit.rows,
    by_action: byAction.rows,
    sparkline_7d: sparkline.rows,
    trends: {
      actions_this_month: currentMonth.rows[0].count,
      actions_prev_month: prevMonthActions.rows[0].count
    }
  };
}

async function getAnalytics(days = 30) {
  const [users, usageStats, modelUsage, topUsers, daily] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE plan = 'pro')::int AS pro,
        COUNT(*) FILTER (WHERE plan = 'free')::int AS free,
        COUNT(*) FILTER (WHERE created_at >= NOW() - ($1 || ' days')::interval)::int AS new_users
      FROM users
    `, [days]),
    db.query(`
      SELECT
        COUNT(*)::int AS total_actions,
        COUNT(DISTINCT user_id)::int AS active_users,
        COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM usage
      WHERE created_at >= NOW() - ($1 || ' days')::interval
    `, [days]),
    db.query(`
      SELECT model,
        COUNT(*)::int AS count,
        COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM usage
      WHERE created_at >= NOW() - ($1 || ' days')::interval
      GROUP BY model ORDER BY count DESC
    `, [days]),
    db.query(`
      SELECT u.email, COUNT(*)::int AS actions
      FROM usage us JOIN users u ON u.id = us.user_id
      WHERE us.created_at >= NOW() - ($1 || ' days')::interval
      GROUP BY u.email ORDER BY actions DESC LIMIT 10
    `, [days]),
    getDailyActions(days)
  ]);

  const u = users.rows[0];
  const s = usageStats.rows[0];
  const mrr = u.pro * PRO_PRICE;
  const conversion = u.total ? Math.round((u.pro / u.total) * 1000) / 10 : 0;
  const avgActions = s.active_users ? Math.round((s.total_actions / s.active_users) * 10) / 10 : 0;

  let estimatedCost = 0;
  const costBreakdown = modelUsage.rows.map((row) => {
    const cost = estimateTokenCost(row.model, row.input_tokens, row.output_tokens);
    estimatedCost += cost;
    return { ...row, estimated_cost_usd: Math.round(cost * 10000) / 10000 };
  });

  return {
    period_days: days,
    users: u,
    usage: s,
    mrr_usd: mrr,
    conversion_rate: conversion,
    avg_actions_per_user: avgActions,
    estimated_ai_cost_usd: Math.round(estimatedCost * 100) / 100,
    margin_estimate_usd: Math.round((mrr - estimatedCost) * 100) / 100,
    cost_by_model: costBreakdown,
    top_users: topUsers.rows,
    daily_actions: daily
  };
}

async function getActivityFeed(limit = 40) {
  const [signups, usage, upgrades] = await Promise.all([
    db.query(
      `SELECT 'signup' AS type, email AS label, created_at FROM users
       ORDER BY created_at DESC LIMIT $1`,
      [Math.ceil(limit / 3)]
    ),
    db.query(
      `SELECT 'action' AS type,
        CONCAT(u.email, ' · ', us.action) AS label,
        us.created_at, us.model
       FROM usage us JOIN users u ON u.id = us.user_id
       ORDER BY us.created_at DESC LIMIT $1`,
      [Math.ceil(limit / 2)]
    ),
    db.query(
      `SELECT 'upgrade' AS type, email AS label, updated_at AS created_at
       FROM users WHERE plan = 'pro'
       ORDER BY updated_at DESC LIMIT $1`,
      [Math.ceil(limit / 4)]
    )
  ]);

  const events = [
    ...signups.rows.map((r) => ({ ...r, icon: '👤' })),
    ...usage.rows.map((r) => ({ ...r, icon: '⚡' })),
    ...upgrades.rows.map((r) => ({ ...r, icon: '⭐' }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);

  return { events };
}

module.exports = {
  parseDays,
  getOverviewCharts,
  getAnalytics,
  getActivityFeed,
  getDailyActions,
  estimateTokenCost
};
