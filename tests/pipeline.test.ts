import { describe, expect, it } from 'vitest';
import { canCompleteBaseline, isMeaningfulPriceDrop, shouldNotify } from '../src/jobs/pipeline.js';

describe('price-change notification logic', () => {
  it('allows a meaningful drop and ignores noise', () => {
    expect(isMeaningfulPriceDrop(25_000, 23_900)).toBe(true);
    expect(isMeaningfulPriceDrop(25_000, 24_800)).toBe(false);
    expect(isMeaningfulPriceDrop(null, 24_000)).toBe(false);
  });

  it('notifies only actionable, high-score, unseen versions', () => {
    expect(shouldNotify({ totalScore: 70, recommendedAction: 'call' }, 70, false)).toBe(true);
    expect(shouldNotify({ totalScore: 90, recommendedAction: 'review' }, 70, false)).toBe(false);
    expect(shouldNotify({ totalScore: 69, recommendedAction: 'inspect' }, 70, false)).toBe(false);
    expect(shouldNotify({ totalScore: 90, recommendedAction: 'inspect' }, 70, true)).toBe(false);
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
