import type { SourceName } from '../domain/types.js';
import { AllegroAdapter } from './allegro.js';
import type { MarketplaceAdapter } from './marketplace.js';
import { OlxAdapter } from './olx.js';
import { OtomotoAdapter } from './otomoto.js';

export function createAdapters(options: {
  headless: boolean;
  maxListings: number;
  maxSearchPages: number;
  detailConcurrency: number;
}): Record<SourceName, MarketplaceAdapter> {
  return {
    otomoto: new OtomotoAdapter(options),
    olx: new OlxAdapter(options),
    allegro: new AllegroAdapter(options),
  };
}
