/** Browser-memory operational history. Never accepts article text or error messages. */
export const ACTIVITY_EVENTS = ['analysis', 'verification', 'research', 'demo', 'popup', 'export', 'reset'] as const;
export const ACTIVITY_STATUSES = ['started', 'completed', 'failed', 'cancelled'] as const;
export type ActivityEvent = typeof ACTIVITY_EVENTS[number];
export type ActivityStatus = typeof ACTIVITY_STATUSES[number];
export type ActivityEntry = Readonly<{ id: number; at: number; event: ActivityEvent; status: ActivityStatus; durationMs?: number; count?: number }>;
export const MAX_ACTIVITY_ENTRIES = 40;
const EMPTY: readonly ActivityEntry[] = Object.freeze([]);
let entries: readonly ActivityEntry[] = EMPTY;
let sequence = 0;
const listeners = new Set<() => void>();
function boundedNumber(value: unknown, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), max) : undefined;
}
export function recordActivity(event: ActivityEvent, status: ActivityStatus, details?: { durationMs?: number; count?: number }) {
  if (!ACTIVITY_EVENTS.includes(event) || !ACTIVITY_STATUSES.includes(status)) return;
  const durationMs = boundedNumber(details?.durationMs, 3_600_000), count = boundedNumber(details?.count, 10_000);
  const entry: ActivityEntry = Object.freeze({ id: ++sequence, at: Date.now(), event, status, ...(durationMs === undefined ? {} : { durationMs }), ...(count === undefined ? {} : { count }) });
  entries = Object.freeze([...entries, entry].slice(-MAX_ACTIVITY_ENTRIES));
  for (const listener of listeners) listener();
}
export function getActivity(): readonly ActivityEntry[] { return entries; }
export function getServerActivity(): readonly ActivityEntry[] { return EMPTY; }
export function subscribeActivity(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function clearActivity() { entries = EMPTY; for (const listener of listeners) listener(); }
