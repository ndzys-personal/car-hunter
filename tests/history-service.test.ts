import { describe, expect, it, vi } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import type { HistoricalVehicleRecord, PersistedListing } from '../src/domain/types.js';
import { VehicleHistoryService, type HistoryPersistence } from '../src/history/service.js';
import { normalizeListing } from '../src/services/normalization.js';
import { rawListing } from './fixtures.js';

function persisted(): PersistedListing {
  const base = normalizeListing(rawListing(), searchProfiles[0]!);
  return {
    ...base,
    id: 'l1',
    vehicleId: 'v1',
    firstSeenAt: base.scrapedAt,
    lastSeenAt: base.scrapedAt,
    previousMaterialHash: null,
    previousPricePln: null,
    isNew: true,
    materiallyChanged: false,
  };
}

describe('history search cache', () => {
  it('does not search the same VIN again while cache inputs and TTL are unchanged', async () => {
    const records: HistoricalVehicleRecord[] = [];
    const cache = {
      historyCheckedAt: null as string | null,
      historyCheckVersion: null as string | null,
      listingFingerprint: null as string | null,
      sellerFingerprint: null as string | null,
    };
    const persistence: HistoryPersistence = {
      getHistoryRecords: () => Promise.resolve(records),
      getHistoryCache: () => Promise.resolve(cache),
      saveExternalHistory: (_vehicleId, found) => {
        records.push(...found);
        return Promise.resolve();
      },
      markHistoryChecked: (_vehicleId, input) => {
        cache.historyCheckedAt = input.checkedAt;
        cache.historyCheckVersion = input.version;
        cache.listingFingerprint = input.listingFingerprint;
        cache.sellerFingerprint = input.sellerFingerprint;
        return Promise.resolve();
      },
      saveHistorySignals: () => Promise.resolve(),
    };
    const searchByVin = vi.fn(() => Promise.resolve([]));
    const service = new VehicleHistoryService(
      persistence,
      [{ name: 'test', version: '1', searchByVin }],
      7 * 86_400_000,
    );
    await service.analyze(persisted());
    await service.analyze(persisted());
    expect(searchByVin).toHaveBeenCalledTimes(1);
    expect(searchByVin).toHaveBeenCalledWith('WBAVT71090A123456');
  });
});
