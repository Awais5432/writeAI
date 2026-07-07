const { verifyToken } = require('../services/panelAuth');

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'no_token', message: 'Please sign in.' });
  }

  try {
    const admin = await verifyToken(token);
    req.panelAdmin = admin;
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid_token', message: 'Session expired. Please sign in again.' });
  }
};
