import { PlaywrightMarketplaceAdapter } from './playwright-adapter.js';

export class AllegroAdapter extends PlaywrightMarketplaceAdapter {
  readonly name = 'allegro' as const;

  protected matchesListingUrl(url: URL): boolean {
    return /(^|\.)allegro\.pl$/.test(url.hostname) && /\/oferta\//.test(url.pathname);
  }

  protected externalId(url: URL): string {
    return url.pathname.match(/-(\d{8,})$/)?.[1] ?? url.pathname.split('/').at(-1) ?? url.pathname;
  }
}
