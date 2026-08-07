import { describe, expect, it } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import { normalizeListing } from '../src/services/normalization.js';
import { scoreListing } from '../src/services/scoring.js';
import { rawListing } from './fixtures.js';

describe('scoreListing', () => {
  it('gives a strong score to a transparent matching car', () => {
    const profile = searchProfiles[0]!;
    const listing = normalizeListing(rawListing(), profile);
    const score = scoreListing(listing, profile);
    expect(score.rejected).toBe(false);
    expect(score.totalScore).toBeGreaterThanOrEqual(80);
  });

  it('hard-rejects an excessively expensive listing', () => {
    const profile = searchProfiles[0]!;
    const listing = normalizeListing(rawListing({ priceText: '99 000 PLN' }), profile);
    const score = scoreListing(listing, profile);
    expect(score.rejected).toBe(true);
    expect(score.totalScore).toBeLessThan(50);
  });

  it('uses a soft penalty above the ideal price', () => {
    const profile = searchProfiles[0]!;
    const listing = normalizeListing(rawListing({ priceText: '39 000 PLN' }), profile);
    const score = scoreListing(listing, profile);
    expect(score.rejected).toBe(false);
    expect(score.breakdown.price).toBeGreaterThan(0);
    expect(score.breakdown.price).toBeLessThan(20);
  });

  it('rejects a non-BMW leaked by broad marketplace filters', () => {
    const profile = searchProfiles[0]!;
    const listing = normalizeListing(
      rawListing({
        title: 'Audi A4 Avant 2.0 TDI',
        description: 'Kombi z 2008 roku',
        attributes: { 'Rok produkcji': '2008', Nadwozie: 'Kombi' },
      }),
      profile,
    );
    expect(listing.make).toBe('unknown');
    expect(scoreListing(listing, profile).rejected).toBe(true);
  });

  it('rejects a different BMW generation but accepts an E90 sedan', () => {
    const profile = searchProfiles[0]!;
    const wrongGeneration = normalizeListing(
      rawListing({ title: 'BMW F31 320i Touring', attributes: { 'Rok produkcji': '2012' } }),
      profile,
    );
    const wrongBody = normalizeListing(
      rawListing({
        title: 'BMW E90 325i Sedan',
        attributes: { 'Rok produkcji': '2007', Nadwozie: 'Sedan' },
      }),
      profile,
    );
    expect(scoreListing(wrongGeneration, profile).rejected).toBe(true);
    expect(scoreListing(wrongBody, profile).rejected).toBe(false);
  });
});
