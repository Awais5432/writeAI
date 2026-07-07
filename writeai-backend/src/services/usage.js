const db = require('../db/postgres');
const { getSetting } = require('./settings');

async function getFreeLimit() {
  const limits = await getSetting('limits');
  return limits.free_monthly_actions ?? 20;
}

async function getMonthlyCount(userId) {
  const monthYear = new Date().toISOString().slice(0, 7);
  const result = await db.query(
    `SELECT action_count FROM monthly_counts
     WHERE user_id = $1 AND month_year = $2`,
    [userId, monthYear]
  );
  return result.rows[0]?.action_count || 0;
}

async function canPerformAction(userId, plan) {
  if (plan === 'pro') return true;
  const limit = await getFreeLimit();
  const count = await getMonthlyCount(userId);
  return count < limit;
}

async function incrementCount(userId) {
  const monthYear = new Date().toISOString().slice(0, 7);
  await db.query(
    `INSERT INTO monthly_counts (user_id, month_year, action_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, month_year)
     DO UPDATE SET action_count = monthly_counts.action_count + 1`,
    [userId, monthYear]
  );
}

async function logUsage(userId, action, model, inputTokens, outputTokens) {
  const monthYear = new Date().toISOString().slice(0, 7);
  await db.query(
    `INSERT INTO usage (user_id, action, model, input_tokens, output_tokens, month_year)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, action, model, inputTokens ?? 0, outputTokens ?? 0, monthYear]
  );
}

module.exports = {
  canPerformAction,
  incrementCount,
  logUsage,
  getMonthlyCount,
  getFreeLimit,
  FREE_LIMIT: 20
};
