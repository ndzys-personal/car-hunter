import { describe, expect, it } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import { isFreshListing, scoreFreshness } from '../src/services/freshness.js';
import { normalizeListing } from '../src/services/normalization.js';
import { scoreListing } from '../src/services/scoring.js';
import { rawListing } from './fixtures.js';

describe('listing freshness', () => {
  const profile = searchProfiles[0]!;
  const observedAt = '2026-08-07T12:00:00.000Z';

  it('uses publishedAt only and never first discovery time', () => {
    const unknown = normalizeListing(
      rawListing({ publishedAt: null, scrapedAt: observedAt }),
      profile,
    );
    expect(scoreFreshness(unknown, profile)).toBe(0);
    expect(scoreListing(unknown, profile).breakdown.freshness).toBe(0);
    expect(isFreshListing(unknown, profile.preferences.freshness.windowHours)).toBe(false);
  });

  it('awards only the configured small reliable-publication bonus', () => {
    const within24 = normalizeListing(
      rawListing({ publishedAt: '2026-08-07T02:00:00.000Z', scrapedAt: observedAt }),
      profile,
    );
    const within72 = normalizeListing(
      rawListing({ publishedAt: '2026-08-05T12:00:00.000Z', scrapedAt: observedAt }),
      profile,
    );
    expect(scoreFreshness(within24, profile)).toBe(4);
    expect(scoreFreshness(within72, profile)).toBe(2);
  });

  it('does not penalize an excellent older listing', () => {
    const old = normalizeListing(
      rawListing({ publishedAt: '2026-07-20T12:00:00.000Z', scrapedAt: observedAt }),
      profile,
    );
    const score = scoreListing(old, profile);
    expect(score.breakdown.freshness).toBe(0);
    expect(score.rejected).toBe(false);
    expect(score.totalScore).toBeGreaterThanOrEqual(80);
  });

  it('cannot make a hard-rejected listing recommendable by itself', () => {
    const rejected = normalizeListing(
      rawListing({
        priceText: '60 000 PLN',
        publishedAt: '2026-08-07T11:30:00.000Z',
        scrapedAt: observedAt,
      }),
      profile,
    );
    const score = scoreListing(rejected, profile);
    expect(score.breakdown.freshness).toBe(4);
    expect(score.rejected).toBe(true);
    expect(score.totalScore).toBeLessThan(70);
  });
});
