import { describe, expect, it } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import { normalizeListing } from '../src/services/normalization.js';
import { scoreListing } from '../src/services/scoring.js';
import { detectSellerType } from '../src/services/seller-detection.js';
import { rawListing } from './fixtures.js';

describe('seller behaviour detection', () => {
  const profile = searchProfiles[0]!;

  it('treats a normal personal OLX listing as private or likely private', () => {
    const listing = normalizeListing(
      rawListing({
        source: 'olx',
        declaredSellerType: 'private',
        currentActiveVehicleCount: 1,
        description:
          'Mam auto od 4 lat. Użytkowane przeze mnie na dojazdy. Sprzedaję z powodu zakupu większego auta. Wymieniałem pompę wody i mam faktury.',
      }),
      profile,
    );
    const assessment = detectSellerType(listing);
    expect(['private', 'likely_private']).toContain(assessment.inferredType);
    expect(assessment.confidence).toBeLessThanOrEqual(0.4);
  });

  it('detects a private-labelled VAT/finance seller with many cars as a dealer', () => {
    const listing = normalizeListing(
      rawListing({
        source: 'olx',
        declaredSellerType: 'private',
        currentActiveVehicleCount: 9,
        description:
          'VAT marża. Oferujemy finansowanie, kredyt i raty. Zapraszamy, więcej aut na profilu.',
      }),
      profile,
    );
    const assessment = detectSellerType(listing);
    expect(assessment.inferredType).toBe('dealer');
    expect(assessment.confidence).toBeGreaterThanOrEqual(0.8);
    expect(assessment.signals.join(' ')).toMatch(/VAT|finansowanie|9 aktywnych/i);
  });

  it('uses historical vehicle turnover as strong evidence', () => {
    const listing = normalizeListing(
      rawListing({ source: 'olx', declaredSellerType: 'private' }),
      profile,
    );
    listing.sellerHistory = {
      currentActiveVehicleCount: 1,
      historicalVehicleCount: 12,
      uniqueMakesCount: 3,
      firstSeenSellerAt: '2026-05-01T10:00:00Z',
      lastSeenSellerAt: listing.scrapedAt,
    };
    const assessment = detectSellerType(listing);
    expect(['likely_dealer', 'dealer']).toContain(assessment.inferredType);
    expect(assessment.signals.join(' ')).toMatch(/12 różnych pojazdów/i);
  });

  it('does not treat an imported car alone as dealer behaviour', () => {
    const listing = normalizeListing(
      rawListing({
        source: 'olx',
        declaredSellerType: 'private',
        description: 'Samochód sprowadzony z Niemiec. Stan dobry.',
      }),
      profile,
    );
    expect(['private', 'likely_private']).toContain(detectSellerType(listing).inferredType);
  });

  it('does not treat two active cars alone as dealer behaviour', () => {
    const listing = normalizeListing(
      rawListing({
        source: 'olx',
        declaredSellerType: 'private',
        currentActiveVehicleCount: 2,
        description: 'Sprzedam BMW używane prywatnie.',
      }),
      profile,
    );
    expect(['private', 'likely_private']).toContain(detectSellerType(listing).inferredType);
  });

  it('does not hard-reject a genuinely strong car sold by a dealer', () => {
    const listing = normalizeListing(
      rawListing({
        declaredSellerType: 'dealer',
        sellerCompanyName: 'BMW Auto Centrum',
      }),
      profile,
    );
    const score = scoreListing(listing, profile);
    expect(score.breakdown.seller).toBe(-10);
    expect(score.rejected).toBe(false);
    expect(score.totalScore).toBeGreaterThanOrEqual(70);
  });

  it('always returns evidence, dealer probability and a Polish explanation', () => {
    const assessment = detectSellerType(normalizeListing(rawListing(), profile));
    expect(assessment.signals.length).toBeGreaterThan(0);
    expect(assessment.confidence).toBeGreaterThanOrEqual(0);
    expect(assessment.confidence).toBeLessThanOrEqual(1);
    expect(assessment.riskExplanation.length).toBeGreaterThan(20);
  });
});
