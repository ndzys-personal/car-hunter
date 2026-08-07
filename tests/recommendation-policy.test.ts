import { describe, expect, it } from 'vitest';
import type { RawListingAnalysis } from '../src/ai/schema.js';
import { applyRecommendationPolicy } from '../src/ai/recommendation-policy.js';
import { searchProfiles } from '../src/config/searches.js';
import { normalizeListing } from '../src/services/normalization.js';
import { scoreListing } from '../src/services/scoring.js';
import { rawListing } from './fixtures.js';

function rawAnalysis(overrides: Partial<RawListingAnalysis> = {}): RawListingAnalysis {
  return {
    sellerDeclaredType: 'private',
    sellerInferredType: 'private',
    sellerConfidence: 0.95,
    sellerSignals: [],
    likelyEngine: 'N52B30',
    engineConfidence: 0.95,
    analysisConfidence: 0.95,
    majorUncertainties: [],
    fitScore: 100,
    riskScore: 0,
    priceAssessment: 'Atrakcyjna cena rynkowa.',
    positives: ['xDrive poprawia trakcję', 'M-pakiet', 'Bogate wyposażenie'],
    redFlags: [],
    questionsForSeller: ['Czy jest VIN?'],
    verificationItems: ['Sprawdzić VIN.', 'Sprawdzić historię serwisową.'],
    summary: 'Kandydat do sprawdzenia.',
    verdict: 'Warto działać.',
    recommendedAction: 'inspect',
    ...overrides,
  };
}

describe('applyRecommendationPolicy', () => {
  it('removes generic xDrive/M-package positives and stages missing data as a call', () => {
    const profile = searchProfiles[0]!;
    const listing = normalizeListing(
      rawListing({
        title: 'BMW E90 325xi Sedan',
        description: 'Benzyna, automat. Więcej informacji telefonicznie.',
        attributes: {
          'Rok produkcji': '2009',
          Przebieg: '310 000 km',
          'Rodzaj paliwa': 'Benzyna',
          Pojemność: '2996 cm3',
          Moc: '218 KM',
          Nadwozie: 'Sedan',
          Napęd: 'xDrive',
          'Skrzynia biegów': 'Automatyczna',
        },
      }),
      profile,
    );
    const result = applyRecommendationPolicy(
      rawAnalysis({
        redFlags: ['Wysoki przebieg 310 000 km.'],
        summary:
          'Cena atrakcyjna na tle rynku. Silnik 3.0 odpowiada preferencjom. Kandydat do sprawdzenia.',
      }),
      listing,
      profile,
      scoreListing(listing, profile),
    );

    expect(result.likelyEngine).toBe('N52B30_or_N53B30');
    expect(result.engineConfidence).toBeLessThanOrEqual(0.7);
    expect(result.positives.join(' ')).not.toMatch(/xDrive|M-pakiet/i);
    expect(result.positives.join(' ')).not.toMatch(/pożądany silnik|3[.,]0|218\s*KM/i);
    expect(result.redFlags.join(' ')).toMatch(/xDrive/i);
    expect(result.recommendedAction).toBe('call');
    expect(result.totalScore).toBeLessThan(90);
    expect(result.priceAssessment).toBe('Cena mieści się w budżecie.');
    expect(result.summary).not.toMatch(/atrakcyjna.*rynk/i);
    expect(result.summary).not.toMatch(/3[.,]0.*preferenc/i);
    expect(result.summary).toMatch(/N52B30 lub N53B30 wymaga weryfikacji po VIN/i);
    expect(result.redFlags.join(' ')).toMatch(/udokumentowana historia obsługi/i);
    expect(result.verificationItems.join(' ')).toMatch(/serwis xDrive/i);
    expect(result.sellerDeclaredType).toBe('private');
    expect(result.sellerInferredType).toBe('private');
    expect(result.sellerConfidence).toBeLessThanOrEqual(0.7);
  });

  it('allows inspect only when VIN, engine and service evidence are sufficiently clear', () => {
    const profile = searchProfiles[0]!;
    const listing = normalizeListing(rawListing(), profile);
    const result = applyRecommendationPolicy(
      rawAnalysis({
        likelyEngine: 'N52B25',
        verificationItems: ['Sprawdzić VIN.', 'Sprawdzić faktury.'],
      }),
      listing,
      profile,
      scoreListing(listing, profile),
    );
    expect(result.recommendedAction).toBe('inspect');
  });
});
