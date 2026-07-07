const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/postgres');
const config = require('../config');

const TOKEN_TYPE = 'panel_admin';

async function findByUsername(username) {
  const result = await db.query(
    `SELECT id, username, password_hash, display_name, is_active
     FROM panel_admins WHERE username = $1`,
    [username.toLowerCase().trim()]
  );
  return result.rows[0] || null;
}

async function login(username, password) {
  const admin = await findByUsername(username);
  if (!admin || !admin.is_active) {
    return { error: 'invalid_credentials', message: 'Invalid username or password.' };
  }

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) {
    return { error: 'invalid_credentials', message: 'Invalid username or password.' };
  }

  await db.query(
    'UPDATE panel_admins SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
    [admin.id]
  );

  const token = jwt.sign(
    { adminId: admin.id, username: admin.username, type: TOKEN_TYPE },
    config.jwt.secret,
    { expiresIn: config.panel.sessionExpiresIn }
  );

  return {
    token,
    admin: {
      id: admin.id,
      username: admin.username,
      display_name: admin.display_name || admin.username
    }
  };
}

async function verifyToken(token) {
  const decoded = jwt.verify(token, config.jwt.secret);
  if (decoded.type !== TOKEN_TYPE) {
    throw new Error('Invalid token type');
  }

  const result = await db.query(
    `SELECT id, username, display_name, is_active, last_login_at, created_at
     FROM panel_admins WHERE id = $1`,
    [decoded.adminId]
  );

  if (!result.rows.length || !result.rows[0].is_active) {
    throw new Error('Admin not found');
  }

  return result.rows[0];
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function upsertAdmin(username, password, displayName) {
  const hash = await hashPassword(password);
  const result = await db.query(
    `INSERT INTO panel_admins (username, password_hash, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           display_name = EXCLUDED.display_name,
           updated_at = NOW()
     RETURNING id, username, display_name`,
    [username.toLowerCase().trim(), hash, displayName || username]
  );
  return result.rows[0];
}

async function updateProfile(adminId, { display_name }) {
  const result = await db.query(
    `UPDATE panel_admins SET display_name = $1, updated_at = NOW()
     WHERE id = $2 RETURNING id, username, display_name, last_login_at, created_at`,
    [display_name?.trim() || null, adminId]
  );
  return result.rows[0];
}

async function changePassword(adminId, currentPassword, newPassword) {
  const result = await db.query(
    'SELECT password_hash FROM panel_admins WHERE id = $1 AND is_active = true',
    [adminId]
  );
  if (!result.rows.length) {
    return { error: 'not_found', message: 'Admin account not found.' };
  }

  const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
  if (!valid) {
    return { error: 'invalid_password', message: 'Current password is incorrect.' };
  }

  const hash = await hashPassword(newPassword);
  await db.query(
    'UPDATE panel_admins SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [hash, adminId]
  );
  return { ok: true };
}

module.exports = {
  login,
  verifyToken,
  upsertAdmin,
  updateProfile,
  changePassword,
  TOKEN_TYPE
};
