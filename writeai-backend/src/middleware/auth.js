const jwt = require('jsonwebtoken');
const db = require('../db/postgres');
const config = require('../config');

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    const result = await db.query(
      `SELECT id, email, name, avatar_url, plan, role, is_active, subscription_status, stripe_customer_id
       FROM users WHERE id = $1 AND is_active IS NOT FALSE`,
      [decoded.userId]
    );

    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });

    req.user = result.rows[0];
    req.user.userId = result.rows[0].id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};
