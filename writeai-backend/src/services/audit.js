const db = require('../db/postgres');

async function logAudit(req, action, entityType = null, entityId = null, details = {}) {
  try {
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, admin_username, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.panelAdmin?.id || null,
        req.panelAdmin?.username || 'unknown',
        action,
        entityType,
        entityId ? String(entityId) : null,
        JSON.stringify(details),
        req.ip || req.headers['x-forwarded-for'] || null
      ]
    );
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

async function getAuditLog(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const [rows, count] = await Promise.all([
    db.query(
      `SELECT id, admin_username, action, entity_type, entity_id, details, ip_address, created_at
       FROM admin_audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
    db.query('SELECT COUNT(*)::int AS total FROM admin_audit_log')
  ]);
  return {
    logs: rows.rows,
    pagination: {
      page,
      limit,
      total: count.rows[0].total,
      pages: Math.ceil(count.rows[0].total / limit)
    }
  };
}

module.exports = { logAudit, getAuditLog };
