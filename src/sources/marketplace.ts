import type { MarketplaceFetchResult, SearchProfile, SourceName } from '../domain/types.js';

export interface MarketplaceAdapter {
  readonly name: SourceName;
  fetchListings(profile: SearchProfile, searchUrl: string): Promise<MarketplaceFetchResult>;
}
