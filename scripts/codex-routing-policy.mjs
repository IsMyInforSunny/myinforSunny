// Coding CLI routing only; never controls the website's Groq provider.
export const MAX_USAGE_AGE_MS = 15 * 60 * 1000;
export const THRESHOLD = 0.95;
/** @param {unknown} snapshot @param {number} now */
export function decideProvider(snapshot, now = Date.now()) {
  const fallback = reason => ({provider: 'openai', reason});
  if (snapshot == null) return fallback('usage_unknown');
  const s = /** @type {Record<string, any>} */ (snapshot);
  if (typeof s !== 'object' || Array.isArray(s) || s.version !== 1 ||
      s.unit !== 'credits' || s.scope !== 'monthly' ||
      typeof s.used !== 'number' || !Number.isFinite(s.used) || s.used < 0 ||
      typeof s.limit !== 'number' || !Number.isFinite(s.limit) || s.limit <= 0 ||
      typeof s.checkedAt !== 'string' || !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(s.checkedAt) ||
      typeof s.renewalDate !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(s.renewalDate)) return fallback('usage_invalid');
  const checkedAt = Date.parse(s.checkedAt);
  const renewal = Date.parse(`${s.renewalDate}T00:00:00+09:00`);
  const checkedDay = Date.parse(`${s.checkedAt.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(now) || !Number.isFinite(checkedAt) || !Number.isFinite(renewal) ||
      !Number.isFinite(checkedDay) || new Date(checkedDay).toISOString().slice(0, 10) !== s.checkedAt.slice(0, 10) ||
      new Date(renewal + 9 * 3600000).toISOString().slice(0, 10) !== s.renewalDate || checkedAt > now + 60000)
    return fallback('usage_invalid');
  if (now - checkedAt > MAX_USAGE_AGE_MS || now >= renewal || checkedAt >= renewal)
    return fallback('usage_stale');
  return s.used / s.limit >= THRESHOLD ? fallback('threshold_reached') : {provider: 'factchat', reason: 'below_threshold'};
}
export function buildCodexArgs(provider, session) {
  if (!['factchat', 'openai'].includes(provider)) throw new Error('Invalid provider');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(session)) throw new Error('Invalid session ID');
  return ['-c', `model_provider=${provider}`, ...(provider === 'openai' ? ['-c', 'forced_login_method=chatgpt'] : []),
    '-m', 'gpt-6.1-sol', 'resume', session, '--no-daemon'];
}
