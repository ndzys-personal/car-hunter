import { PlaywrightMarketplaceAdapter } from './playwright-adapter.js';

export class OlxAdapter extends PlaywrightMarketplaceAdapter {
  readonly name = 'olx' as const;

  protected matchesListingUrl(url: URL): boolean {
    return /(^|\.)olx\.pl$/.test(url.hostname) && /\/d\/oferta\//.test(url.pathname);
  }

  protected externalId(url: URL): string {
    return (
      url.pathname.match(/-ID([A-Za-z0-9]+)\.html$/)?.[1] ??
      url.pathname.split('/').at(-1) ??
      url.pathname
    );
  }
}
