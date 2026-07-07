const db = require('../db/postgres');
const config = require('../config');
const { getApiKeys } = require('./ai');
const { getRedisClient } = require('../middleware/rateLimit');

async function checkDatabase() {
  const start = Date.now();
  try {
    await db.query('SELECT 1');
    return { status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    return { status: 'error', message: err.message, latency_ms: Date.now() - start };
  }
}

async function checkRedis() {
  const start = Date.now();
  try {
    const client = await getRedisClient();
    if (!client) return { status: 'skipped', message: 'Redis not configured' };
    await client.ping();
    return { status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    return { status: 'error', message: err.message, latency_ms: Date.now() - start };
  }
}

async function checkOpenAI() {
  try {
    const keys = await getApiKeys();
    if (!keys.openai) return { status: 'warning', message: 'No OpenAI API key configured' };
    return { status: 'ok', message: 'API key configured' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

async function checkGemini() {
  try {
    const keys = await getApiKeys();
    if (!keys.gemini) return { status: 'warning', message: 'No Gemini API key configured' };
    return { status: 'ok', message: 'API key configured' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

async function getSystemHealth() {
  const [database, redis, openai, gemini] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkOpenAI(),
    checkGemini()
  ]);

  const checks = { database, redis, openai, gemini };
  const statuses = Object.values(checks).map((c) => c.status);
  const overall = statuses.includes('error') ? 'error'
    : statuses.includes('warning') ? 'warning' : 'ok';

  return {
    overall,
    checks,
    environment: process.env.NODE_ENV || 'development',
    uptime_seconds: Math.floor(process.uptime()),
    version: '1.0.0'
  };
}

module.exports = { getSystemHealth };
