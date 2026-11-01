/** Strict allowlist: request bodies, query strings, raw errors and credentials cannot enter logs. */
export const AUDIT_EVENTS = ['analyze', 'verify', 'research', 'news'] as const;
export const AUDIT_STATUSES = ['completed', 'rejected', 'failed', 'cancelled'] as const;
export type AuditEvent = typeof AUDIT_EVENTS[number];
export type AuditStatus = typeof AUDIT_STATUSES[number];
export function auditEvent(event: AuditEvent, status: AuditStatus, details?: { durationMs?: number; requestId?: string }) {
  if (!AUDIT_EVENTS.includes(event) || !AUDIT_STATUSES.includes(status)) return;
  const durationMs = typeof details?.durationMs === 'number' && Number.isFinite(details.durationMs) && details.durationMs >= 0 ? Math.min(Math.round(details.durationMs), 3_600_000) : undefined;
  const requestId = typeof details?.requestId === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(details.requestId) ? details.requestId : undefined;
  console.info(JSON.stringify({ type: 'operation', event, status, ...(durationMs === undefined ? {} : { durationMs }), ...(requestId === undefined ? {} : { requestId }) }));
}
