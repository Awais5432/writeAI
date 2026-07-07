const { createClient } = require('redis');
const config = require('../config');

let client = null;

async function getRedisClient() {
  if (client) return client;

  if (!config.redisUrl) {
    return null;
  }

  client = createClient({ url: config.redisUrl });
  client.on('error', (err) => console.error('Redis error:', err));
  await client.connect();
  return client;
}

function rateLimit({ windowMs = 60_000, max = 60, keyPrefix = 'rl' } = {}) {
  return async (req, res, next) => {
    try {
      const redis = await getRedisClient();

      if (!redis) {
        return next();
      }

      const key = `${keyPrefix}:${req.ip}:${req.path}`;
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.pExpire(key, windowMs);
      }

      if (count > max) {
        return res.status(429).json({ error: 'rate_limit_exceeded', message: 'Too many requests. Please try again later.' });
      }

      next();
    } catch (err) {
      console.error('Rate limit error:', err.message);
      next();
    }
  };
}

module.exports = { rateLimit, getRedisClient };
