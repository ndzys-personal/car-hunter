import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import { PlaywrightMarketplaceAdapter } from '../src/sources/playwright-adapter.js';

class LocalMarketplaceAdapter extends PlaywrightMarketplaceAdapter {
  readonly name = 'olx' as const;

  protected matchesListingUrl(url: URL): boolean {
    return url.hostname === '127.0.0.1' && url.pathname.startsWith('/listing/');
  }

  protected externalId(url: URL): string {
    return url.pathname.split('/').at(-1) ?? '';
  }
}

const browserAvailable = existsSync(chromium.executablePath());

describe.skipIf(!browserAvailable)('Playwright marketplace adapter', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (request.url === '/search') {
        response.end('<a href="/listing/one">one</a><a rel="next" href="/search?page=2">next</a>');
        return;
      }
      if (request.url === '/search?page=2') {
        response.end('<a href="/listing/two">two</a>');
        return;
      }
      const id = request.url?.split('/').at(-1) ?? 'unknown';
      const datePosted =
        id === 'one' ? new Date(Date.now() - 60 * 60_000).toISOString() : undefined;
      response.end(`<!doctype html><html><head>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Vehicle',
          name: `BMW E91 325i Touring ${id}`,
          description: 'Prywatne ogłoszenie testowe',
          datePosted,
          vehicleModelDate: 2006,
          fuelType: 'Benzyna',
          vehicleTransmission: 'Automatyczna',
          mileageFromOdometer: { value: 267000 },
          vehicleEngine: {
            engineDisplacement: { value: 2497 },
            enginePower: { value: 218 },
          },
          offers: { price: id === 'one' ? 21900 : 22900, seller: { name: 'Jan' } },
          additionalProperty: [
            { name: 'Typ nadwozia', value: 'Kombi' },
            { name: 'Model', value: 'Seria 3' },
          ],
        })}</script></head><body><p>Osoba prywatna</p></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not start');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('follows pagination and extracts JSON-LD listing details', async () => {
    const adapter = new LocalMarketplaceAdapter({
      headless: true,
      maxListings: 10,
      maxSearchPages: 3,
      detailConcurrency: 2,
    });
    const result = await adapter.fetchListings(searchProfiles[0]!, `${baseUrl}/search`);
    expect(result.errors).toBe(0);
    expect(result.listings).toHaveLength(2);
    expect(result.listings.map((listing) => listing.externalId).sort()).toEqual(['one', 'two']);
    expect(result.listings[0]).toMatchObject({
      declaredSellerType: 'private',
      sellerName: 'Jan',
      attributes: {
        'Rok produkcji': '2006',
        'Rodzaj paliwa': 'Benzyna',
        'Typ nadwozia': 'Kombi',
      },
    });
    const dated = result.listings.find((listing) => listing.externalId === 'one');
    const undated = result.listings.find((listing) => listing.externalId === 'two');
    expect(dated?.publishedAt).not.toBeNull();
    expect(undated?.publishedAt).toBeNull();
  }, 20_000);

  it('reports a truncation error when a safety limit hides results', async () => {
    const adapter = new LocalMarketplaceAdapter({
      headless: true,
      maxListings: 1,
      maxSearchPages: 3,
      detailConcurrency: 1,
    });
    const result = await adapter.fetchListings(searchProfiles[0]!, `${baseUrl}/search`);
    expect(result.listings).toHaveLength(1);
    expect(result.errors).toBe(1);
  }, 20_000);
});
