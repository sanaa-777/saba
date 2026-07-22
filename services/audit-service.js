// Audit Log Service
// Records all admin actions for accountability and debugging

/**
 * Log an admin action
 * @param {Object} db - Database instance
 * @param {Object} params
 */
function logAction(db, { admin, action, entityType, entityId, oldValues, newValues, ip }) {
  try {
    db.prepare(
      'INSERT INTO audit_log (admin_user, action, entity_type, entity_id, old_values, new_values, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      admin || 'system',
      action,
      entityType || null,
      entityId || null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ip || null
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

/**
 * Get audit logs with pagination
 * @param {Object} db
 * @param {Object} options
 * @returns {Object} { logs, total, totalPages }
 */
function getLogs(db, { page = 1, limit = 50, action, entityType, admin } = {}) {
  let where = 'WHERE 1=1';
  const params = [];

  if (action) { where += ' AND action = ?'; params.push(action); }
  if (entityType) { where += ' AND entity_type = ?'; params.push(entityType); }
  if (admin) { where += ' AND admin_user = ?'; params.push(admin); }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_log ${where}`).get(...params).cnt;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;

  const logs = db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return { logs, total, totalPages, page };
}

module.exports = { logAction, getLogs };
