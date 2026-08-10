import { describe, expect, it } from 'vitest';
import {
  canCompleteBaseline,
  isMeaningfulPriceDrop,
  isNotificationEvent,
  shouldAnalyzeListing,
  shouldAttemptTelegram,
  shouldNotify,
} from '../src/jobs/pipeline.js';

describe('price-change notification logic', () => {
  it('allows a meaningful drop and ignores noise', () => {
    expect(isMeaningfulPriceDrop(25_000, 23_900)).toBe(true);
    expect(isMeaningfulPriceDrop(25_000, 24_800)).toBe(false);
    expect(isMeaningfulPriceDrop(null, 24_000)).toBe(false);
  });

  it('notifies every unseen new listing regardless of AI score or action', () => {
    expect(shouldNotify(false)).toBe(true);
    expect(shouldNotify(true)).toBe(false);
  });

  it('analyzes every new scan listing and keeps the threshold for other work', () => {
    const input = {
      mode: 'scan',
      skipAi: false,
      aiAvailable: true,
      isNew: true,
      rejected: true,
      totalScore: 10,
      threshold: 55,
    } as const;
    expect(shouldAnalyzeListing(input)).toBe(true);
    expect(shouldAnalyzeListing({ ...input, isNew: false })).toBe(false);
    expect(shouldAnalyzeListing({ ...input, isNew: false, rejected: false, totalScore: 55 })).toBe(
      true,
    );
    expect(shouldAnalyzeListing({ ...input, skipAi: true })).toBe(false);
    expect(shouldAnalyzeListing({ ...input, aiAvailable: false })).toBe(false);
    expect(shouldAnalyzeListing({ ...input, mode: 'baseline' })).toBe(false);
  });

  it('allows Telegram only for newly discovered listings', () => {
    expect(isNotificationEvent(true)).toBe(true);
    expect(isNotificationEvent(false)).toBe(false);
  });

  it('never notifies for baseline imports and can notify new post-baseline listings', () => {
    expect(shouldAttemptTelegram('baseline', true)).toBe(false);
    expect(shouldAttemptTelegram('baseline', false)).toBe(false);
    expect(shouldAttemptTelegram('scan', false)).toBe(false);
    expect(shouldAttemptTelegram('scan', true)).toBe(true);
  });

  it('completes only a full, successful, non-empty baseline', () => {
    const full = { mode: 'baseline', skipAi: false } as const;
    expect(canCompleteBaseline(full, { processed: 1, errors: 0 })).toBe(true);
    expect(canCompleteBaseline({ ...full, source: 'olx' }, { processed: 1, errors: 0 })).toBe(
      false,
    );
    expect(canCompleteBaseline(full, { processed: 1, errors: 1 })).toBe(false);
    expect(canCompleteBaseline(full, { processed: 0, errors: 0 })).toBe(false);
  });
});
