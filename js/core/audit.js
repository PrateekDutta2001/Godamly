/** Append-only audit trail. */
import { db } from './db.js';

export function logAudit(action, entity, entityId, details, actor) {
  let userId = actor?.id || '';
  let userName = actor?.fullName || '';
  if (!userName) {
    try {
      const raw = localStorage.getItem('godamly_session') || sessionStorage.getItem('godamly_session');
      if (raw) {
        const session = JSON.parse(raw);
        const user = db.getById('users', session.userId);
        if (user) {
          userId = user.id;
          userName = user.fullName;
        }
      }
    } catch {
      /* session unreadable */
    }
  }
  const text = String(details || '').slice(0, 500);
  return db.add('audit_log', {
    action,
    entity,
    entityId: entityId || '',
    details: text,
    userId: userId || '',
    userName: userName || 'System',
    date: new Date().toISOString(),
  });
}
