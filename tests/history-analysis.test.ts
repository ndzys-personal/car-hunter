import { describe, expect, it } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import type { HistoricalVehicleRecord, PersistedListing } from '../src/domain/types.js';
import { analyzeVehicleHistory } from '../src/history/analysis.js';
import { normalizeListing } from '../src/services/normalization.js';
import { rawListing } from './fixtures.js';

function listing(overrides: Partial<PersistedListing> = {}): PersistedListing {
  const base = normalizeListing(
    rawListing({ scrapedAt: '2026-08-10T10:00:00Z' }),
    searchProfiles[0]!,
  );
  return {
    ...base,
    id: 'current',
    vehicleId: 'vehicle-1',
    firstSeenAt: base.scrapedAt,
    lastSeenAt: base.scrapedAt,
    previousMaterialHash: null,
    previousPricePln: null,
    isNew: true,
    materiallyChanged: false,
    ...overrides,
  };
}

function record(overrides: Partial<HistoricalVehicleRecord> = {}): HistoricalVehicleRecord {
  return {
    source: 'OTOMOTO',
    sourceListingId: 'old-1',
    historicalUrl: 'https://example.com/old-1',
    observedAt: '2026-03-28T10:00:00Z',
    publishedAt: '2026-03-28T10:00:00Z',
    pricePln: 25_000,
    mileageKm: 279_735,
    title: 'BMW E91',
    vehicleModel: 'BMW E91',
    location: 'Wrocław',
    sellerId: 'seller-a',
    sellerName: 'Jan',
    sellerType: 'private',
    descriptionExcerpt: 'BMW sprawne, regularnie użytkowane i serwisowane.',
    damageStatus: 'unknown',
    runningStatus: 'running',
    vinConfirmed: true,
    confidence: 'high',
    evidenceUrl: 'https://example.com/old-1',
    origin: 'internal',
    ...overrides,
  };
}

describe('VIN history analysis', () => {
  it('preserves price/mileage observations and calculates the total price drop', () => {
    const result = analyzeVehicleHistory(
      listing({ pricePln: 20_000, mileageKm: 297_000 }),
      [
        record(),
        record({
          historicalUrl: 'https://example.com/old-2',
          evidenceUrl: 'https://example.com/old-2',
          publishedAt: '2026-07-04T10:00:00Z',
          pricePln: 23_000,
          mileageKm: 297_000,
        }),
      ],
      new Date('2026-08-10T10:00:00Z'),
    );
    expect(result.previousPrices).toEqual([25_000, 23_000]);
    expect(result.previousListings.map((item) => item.mileageKm)).toEqual([279_735, 297_000]);
    expect(result.priceDropAmount).toBe(5_000);
    expect(result.priceDropPercent).toBe(20);
    expect(result.historySignals.map((item) => item.type)).toContain('multiple_price_reductions');
  });

  it('makes a reliable mileage decrease a strong warning but treats normal growth as neutral', () => {
    const rollback = analyzeVehicleHistory(listing({ mileageKm: 250_000 }), [
      record({ mileageKm: 279_735 }),
    ]);
    expect(rollback.historySignals.find((item) => item.type === 'mileage_decrease')?.severity).toBe(
      'strong_warning',
    );
    expect(rollback.scoreAdjustment).toBeLessThanOrEqual(-25);
    const normal = analyzeVehicleHistory(listing({ mileageKm: 285_000 }), [
      record({ mileageKm: 279_735 }),
    ]);
    expect(normal.historySignals.some((item) => item.type === 'mileage_decrease')).toBe(false);
  });

  it('detects damaged history and labels a repaired-resale pattern only as possible', () => {
    const result = analyzeVehicleHistory(
      listing({ pricePln: 17_500, sellerName: 'Adam', sourceSellerId: 'seller-b' }),
      [
        record({
          pricePln: 4_700,
          descriptionExcerpt: 'Silnik uszkodzony, nie odpala, do naprawy.',
          damageStatus: 'damaged',
          runningStatus: 'non_running',
        }),
        record({
          historicalUrl: 'https://example.com/new-seller',
          evidenceUrl: 'https://example.com/new-seller',
          publishedAt: '2026-06-01T10:00:00Z',
          sellerId: 'seller-b',
          sellerName: 'Adam',
          pricePln: 17_500,
        }),
      ],
      new Date('2026-08-10T10:00:00Z'),
    );
    expect(result.historySignals.find((item) => item.type === 'previously_damaged')?.severity).toBe(
      'strong_warning',
    );
    const flip = result.historySignals.find((item) => item.type === 'possible_flip');
    expect(flip?.messagePl).toMatch(/może wskazywać|nie jest to potwierdzony fakt/i);
    expect(flip?.evidenceUrls).toContain('https://example.com/old-1');
  });

  it('does not reject based only on long time on market', () => {
    const result = analyzeVehicleHistory(
      listing({ mileageKm: 280_000 }),
      [record()],
      new Date('2026-08-10T10:00:00Z'),
    );
    expect(result.historySignals.map((item) => item.type)).toContain('vehicle_listed_for_months');
    expect(result.scoreAdjustment).toBe(-2);
    expect(result.serious).toBe(false);
  });

  it('ignores unverified/low-confidence VIN occurrences', () => {
    const result = analyzeVehicleHistory(listing(), [
      record({ vinConfirmed: false, confidence: 'low' }),
    ]);
    expect(result.previousListings).toEqual([]);
    expect(result.meaningful).toBe(false);
  });
});
