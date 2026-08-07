import { describe, expect, it } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import { inferEngine } from '../src/services/engine-inference.js';
import { normalizeListing } from '../src/services/normalization.js';
import { rawListing } from './fixtures.js';

describe('inferEngine', () => {
  it('prefers an explicit engine code', () => {
    const listing = normalizeListing(rawListing(), searchProfiles[0]!);
    expect(inferEngine(listing)).toMatchObject({ engine: 'N52B25', confidence: 0.98 });
  });

  it('infers M57 for a period-correct 3.0 diesel', () => {
    const listing = normalizeListing(
      rawListing({
        title: 'BMW E91 330d Touring',
        description: '',
        attributes: {
          'Rok produkcji': '2007',
          'Rodzaj paliwa': 'Diesel',
          Pojemność: '2993 cm3',
        },
      }),
      searchProfiles[0]!,
    );
    expect(inferEngine(listing).engine).toBe('M57');
  });

  it('does not misclassify a four-cylinder 320d as M57', () => {
    const listing = normalizeListing(
      rawListing({
        title: 'BMW E91 320d Touring',
        description: '',
        attributes: {
          'Rok produkcji': '2009',
          'Rodzaj paliwa': 'Diesel',
          Pojemność: '1995 cm3',
        },
      }),
      searchProfiles[0]!,
    );
    expect(inferEngine(listing).engine).toBe('unknown');
  });
});
