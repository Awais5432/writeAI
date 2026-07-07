const authMiddleware = require('./auth');

module.exports = async (req, res, next) => {
  await authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'admin_required', message: 'Admin access required.' });
    }
    if (req.user.is_active === false) {
      return res.status(403).json({ error: 'account_disabled', message: 'This account is disabled.' });
    }
    next();
  });
};
