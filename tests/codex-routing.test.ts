import {describe, expect, it} from 'vitest';
import {decideProvider} from '../scripts/codex-routing-policy.mjs';

// Synthetic monthly credit snapshots only; never reads accounts or starts a Codex session.
const NOW = Date.parse('2026-11-01T14:58:00.000Z'); // 2026-11-01 23:58 KST
const MINUTE = 60_000;
const snapshot = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  unit: 'credits',
  scope: 'monthly',
  used: 11_445,
  limit: 20_000,
  checkedAt: new Date(NOW).toISOString(),
  renewalDate: '2026-11-02',
  ...overrides,
});

describe('coding-provider routing from verified monthly credit snapshots', () => {
  it.each([
    [0, 20_000, 'factchat', 'below_threshold'],
    [11_445, 20_000, 'factchat', 'below_threshold'],
    [17_999.99, 20_000, 'factchat', 'below_threshold'],
    [18_000, 20_000, 'openai', 'threshold_reached'],
    [20_000, 20_000, 'openai', 'threshold_reached'],
    [21_000, 20_000, 'openai', 'threshold_reached'],
    [4_499, 5_000, 'factchat', 'below_threshold'],
    [4_500, 5_000, 'openai', 'threshold_reached'],
  ])('routes used=%s / limit=%s to %s without rounding the threshold', (used, limit, provider, reason) => {
    expect(decideProvider(snapshot({used, limit}), NOW)).toEqual({provider, reason});
  });

  it('keeps the declared monthly denominator across an ordinary Korean midnight', () => {
    const afterMidnightKst = Date.parse('2026-11-01T15:01:00.000Z');
    expect(decideProvider(snapshot({renewalDate: '2026-12-01', used: 18_000}), afterMidnightKst))
      .toEqual({provider: 'openai', reason: 'threshold_reached'});
    expect(decideProvider(snapshot({renewalDate: '2026-12-01', used: 17_999}), afterMidnightKst))
      .toEqual({provider: 'factchat', reason: 'below_threshold'});
  });

  it.each([null, undefined])('uses ChatGPT when the snapshot is missing (%s)', value => {
    expect(decideProvider(value, NOW)).toEqual({provider: 'openai', reason: 'usage_unknown'});
  });

  it.each([
    {version: 2}, {unit: 'tokens'}, {scope: 'daily'},
    {used: -1}, {used: NaN}, {used: Infinity}, {used: '11445'}, {used: null},
    {limit: 0}, {limit: -1}, {limit: NaN}, {limit: Infinity}, {limit: '20000'},
    {checkedAt: 'not-a-date'}, {checkedAt: null},
    {renewalDate: 'not-a-date'}, {renewalDate: '2026-02-30'}, {renewalDate: '2026-13-01'},
  ])('fails closed for invalid monthly credit fields: %j', override => {
    expect(decideProvider(snapshot(override), NOW))
      .toEqual({provider: 'openai', reason: 'usage_invalid'});
  });

  it.each([{}, [], 'snapshot', 0, false])('rejects non-snapshot payloads: %j', value => {
    expect(decideProvider(value, NOW)).toEqual({provider: 'openai', reason: 'usage_invalid'});
  });

  it('accepts a snapshot exactly fifteen minutes old and expires it one millisecond later', () => {
    const value = snapshot({checkedAt: new Date(NOW - 15 * MINUTE).toISOString()});
    expect(decideProvider(value, NOW)).toEqual({provider: 'factchat', reason: 'below_threshold'});
    expect(decideProvider(value, NOW + 1)).toEqual({provider: 'openai', reason: 'usage_stale'});
  });

  it('allows at most sixty seconds of clock skew into the future', () => {
    expect(decideProvider(snapshot({checkedAt: new Date(NOW + MINUTE).toISOString()}), NOW))
      .toEqual({provider: 'factchat', reason: 'below_threshold'});
    expect(decideProvider(snapshot({checkedAt: new Date(NOW + MINUTE + 1).toISOString()}), NOW))
      .toEqual({provider: 'openai', reason: 'usage_invalid'});
  });

  it('expires the previous cycle at Korean midnight even while the snapshot is still fresh', () => {
    const midnightKst = Date.parse('2026-11-01T15:00:00.000Z');
    const value = snapshot();
    expect(decideProvider(value, midnightKst - 1))
      .toEqual({provider: 'factchat', reason: 'below_threshold'});
    expect(decideProvider(value, midnightKst))
      .toEqual({provider: 'openai', reason: 'usage_stale'});
  });

  it('does not restore BAZE after midnight using an unchanged previous-cycle snapshot', () => {
    const midnightKst = Date.parse('2026-11-01T15:00:00.000Z');
    expect(decideProvider(snapshot({used: 18_000}), midnightKst))
      .toEqual({provider: 'openai', reason: 'usage_stale'});
  });

  it('accepts a real leap-day renewal date rather than rejecting all February 29 dates', () => {
    expect(decideProvider(snapshot({renewalDate: '2028-02-29'}), NOW))
      .toEqual({provider: 'factchat', reason: 'below_threshold'});
  });

  it('rejects an impossible checkedAt calendar date even when Date.parse normalizes it to now', () => {
    const marchNow = Date.parse('2026-03-02T00:00:00.000Z');
    expect(decideProvider(snapshot({
      checkedAt: '2026-02-30T00:00:00.000Z', renewalDate: '2026-04-01',
    }), marchNow)).toEqual({provider: 'openai', reason: 'usage_invalid'});
  });
});
