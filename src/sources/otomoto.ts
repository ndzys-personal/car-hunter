import { PlaywrightMarketplaceAdapter } from './playwright-adapter.js';

export class OtomotoAdapter extends PlaywrightMarketplaceAdapter {
  readonly name = 'otomoto' as const;

  protected matchesListingUrl(url: URL): boolean {
    return /(^|\.)otomoto\.pl$/.test(url.hostname) && /\/osobowe\/oferta\//.test(url.pathname);
  }

  protected externalId(url: URL): string {
    return (
      url.pathname.match(/-ID([A-Za-z0-9]+)\.html$/)?.[1] ??
      url.pathname.split('/').at(-1) ??
      url.pathname
    );
  }

  protected publicationDateSelectors(): string[] {
    return [
      '[data-testid="advertisement-created-at"]',
      '[data-testid*="publication-date" i]',
      '[data-testid*="created-at" i]',
      ...super.publicationDateSelectors(),
    ];
  }
}
