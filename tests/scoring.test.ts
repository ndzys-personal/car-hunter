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

  it('keeps E90 fully eligible and gives E91 only a +5 practicality bonus', () => {
    const profile = searchProfiles[0]!;
    const attributes = {
      ...rawListing().attributes,
      Nadwozie: 'Sedan',
    };
    const e90 = normalizeListing(
      rawListing({
        title: 'BMW E90 325i Sedan',
        description: rawListing().description!.replace('Touring', 'Sedan'),
        attributes,
      }),
      profile,
    );
    const e91 = normalizeListing(rawListing(), profile);
    const e90Score = scoreListing(e90, profile);
    const e91Score = scoreListing(e91, profile);
    expect(e90Score.rejected).toBe(false);
    expect(e90Score.breakdown.bodyStyleBonus).toBe(0);
    expect(e91Score.breakdown.bodyStyleBonus).toBe(5);
    expect(e91Score.totalScore - e90Score.totalScore).toBe(5);
  });

  it('keeps E60 fully eligible and gives E61 only a +5 practicality bonus', () => {
    const profile = searchProfiles[1]!;
    const base = {
      title: 'BMW 530i Sedan',
      description: 'BMW Seria 5 z silnikiem N52B30 i napędem na tylne koła.',
      attributes: {
        ...rawListing().attributes,
        'Rok produkcji': '2008',
        Nadwozie: 'Sedan',
        'Pojemność skokowa': '2 996 cm3',
        Moc: '258 KM',
      },
    };
    const e60 = normalizeListing(rawListing(base), profile);
    const e61 = normalizeListing(
      rawListing({
        ...base,
        title: 'BMW 530i Touring',
        description: base.description.replace('Seria 5', 'Seria 5 Touring'),
        attributes: { ...base.attributes, Nadwozie: 'Kombi' },
      }),
      profile,
    );
    const e60Score = scoreListing(e60, profile);
    const e61Score = scoreListing(e61, profile);
    expect(e60.generation).toBe('E60');
    expect(e61.generation).toBe('E61');
    expect(e60Score.rejected).toBe(false);
    expect(e60Score.breakdown.bodyStyleBonus).toBe(0);
    expect(e61Score.breakdown.bodyStyleBonus).toBe(5);
    expect(e61Score.totalScore - e60Score.totalScore).toBe(5);
  });

  it('prefers RWD and penalizes xDrive without hard rejection', () => {
    const profile = searchProfiles[0]!;
    const rwd = normalizeListing(rawListing(), profile);
    const xDrive = normalizeListing(
      rawListing({
        title: 'BMW Seria 3 E91 325xi Touring Automat',
        attributes: { ...rawListing().attributes, Napęd: 'xDrive' },
      }),
      profile,
    );
    const rwdScore = scoreListing(rwd, profile);
    const xDriveScore = scoreListing(xDrive, profile);
    expect(xDriveScore.rejected).toBe(false);
    expect(rwdScore.breakdown.drivetrain).toBe(5);
    expect(xDriveScore.breakdown.drivetrain).toBe(-8);
  });
});
