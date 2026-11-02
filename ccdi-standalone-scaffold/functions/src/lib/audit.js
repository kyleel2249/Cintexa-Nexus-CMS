const { db, admin } = require('./admin');

async function logAudit({ tenantId, action, actorUid, actorEmail, targetType = null, targetId = null, summary = '', metadata = {} }) {
  try {
    await db.collection('audit_log').add({
      tenantId, action, actorUid, actorEmail, targetType, targetId, summary, metadata,
      source: 'server',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      clientTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Never let an audit-log failure fail the primary operation.
    console.error('[audit] write failed', action, err);
  }
}

module.exports = { logAudit };
