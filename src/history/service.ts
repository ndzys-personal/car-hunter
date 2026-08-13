import type {
  HistoricalVehicleRecord,
  PersistedListing,
  VehicleHistoryAnalysis,
} from '../domain/types.js';
import { analyzeVehicleHistory } from './analysis.js';
import type { VehicleHistoryProvider } from './provider.js';

export interface HistoryPersistence {
  getHistoryRecords(vehicleId: string): Promise<HistoricalVehicleRecord[]>;
  getHistoryCache(
    vehicleId: string,
  ): Promise<{
    historyCheckedAt: string | null;
    historyCheckVersion: string | null;
    listingFingerprint: string | null;
    sellerFingerprint: string | null;
  }>;
  saveExternalHistory(vehicleId: string, records: HistoricalVehicleRecord[]): Promise<void>;
  markHistoryChecked(
    vehicleId: string,
    input: {
      checkedAt: string;
      version: string;
      listingFingerprint: string;
      sellerFingerprint: string;
    },
  ): Promise<void>;
  saveHistorySignals(vehicleId: string, analysis: VehicleHistoryAnalysis): Promise<void>;
}

export class VehicleHistoryService {
  constructor(
    private readonly persistence: HistoryPersistence,
    private readonly providers: VehicleHistoryProvider[],
    private readonly ttlMs: number,
  ) {}

  async analyze(
    listing: PersistedListing,
    options: { forceRefresh?: boolean } = {},
  ): Promise<VehicleHistoryAnalysis> {
    if (!listing.vehicleId || !listing.vin) return analyzeVehicleHistory(listing, []);
    const cache = await this.persistence.getHistoryCache(listing.vehicleId);
    const version =
      this.providers.map((provider) => `${provider.name}:${provider.version}`).join(',') ||
      'internal-only:1';
    const listingFingerprint = `${listing.source}:${listing.sourceListingId}`;
    const sellerFingerprint = `${listing.source}:${listing.sourceSellerId ?? listing.sellerName ?? 'unknown'}`;
    const expired =
      !cache.historyCheckedAt ||
      Date.now() - new Date(cache.historyCheckedAt).getTime() >= this.ttlMs;
    const refresh =
      options.forceRefresh ||
      expired ||
      cache.historyCheckVersion !== version ||
      cache.listingFingerprint !== listingFingerprint ||
      cache.sellerFingerprint !== sellerFingerprint;
    let checkedAt = cache.historyCheckedAt;
    if (refresh) {
      const results = await Promise.allSettled(
        this.providers.map((provider) => provider.searchByVin(listing.vin!)),
      );
      const records = results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      );
      if (records.length) await this.persistence.saveExternalHistory(listing.vehicleId, records);
      checkedAt = new Date().toISOString();
      await this.persistence.markHistoryChecked(listing.vehicleId, {
        checkedAt,
        version,
        listingFingerprint,
        sellerFingerprint,
      });
    }
    const records = await this.persistence.getHistoryRecords(listing.vehicleId);
    const analysis = analyzeVehicleHistory(listing, records, new Date(), checkedAt);
    await this.persistence.saveHistorySignals(listing.vehicleId, analysis);
    return analysis;
  }
}
