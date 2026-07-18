const jwt = require('jsonwebtoken');
const db = require('../db/postgres');
const config = require('../config');

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'no_token', message: 'Please sign in to continue.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    const result = await db.query(
      `SELECT id, email, name, avatar_url, plan, role, is_active, subscription_status, stripe_customer_id
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'user_not_found', message: 'Please sign in again.' });
    }

    const user = result.rows[0];

    if (user.is_active === false) {
      return res.status(403).json({
        error: 'account_disabled',
        message: 'Your account has been disabled. Please contact support.'
      });
    }

    req.user = user;
    req.user.userId = user.id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid_token', message: 'Your session expired. Please sign in again.' });
  }
};
