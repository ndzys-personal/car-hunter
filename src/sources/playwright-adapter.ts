import { chromium, type Browser, type Page } from 'playwright';
import type {
  MarketplaceFetchResult,
  RawListing,
  SearchProfile,
  SourceName,
  SellerType,
} from '../domain/types.js';
import { logger } from '../services/logger.js';
import { parseMarketplacePublishedAt } from '../services/publication-date.js';
import type { MarketplaceAdapter } from './marketplace.js';

interface PagePayload {
  title: string;
  description: string;
  priceText?: string | undefined;
  location?: string | undefined;
  sellerName?: string | undefined;
  declaredSellerType: SellerType;
  primaryImageUrl?: string | undefined;
  publicationDateText?: string | undefined;
  attributes: Record<string, string>;
}

export abstract class PlaywrightMarketplaceAdapter implements MarketplaceAdapter {
  abstract readonly name: SourceName;
  protected abstract matchesListingUrl(url: URL): boolean;
  protected abstract externalId(url: URL): string;
  protected publicationDateSelectors(): string[] {
    return [
      '[itemprop="datePosted"]',
      '[itemprop="datePublished"]',
      'meta[property="article:published_time"]',
      'time[data-testid*="publish" i]',
    ];
  }

  constructor(
    private readonly options: {
      headless: boolean;
      maxListings: number;
      maxSearchPages: number;
      detailConcurrency: number;
    },
  ) {}

  async fetchListings(_profile: SearchProfile, searchUrl: string): Promise<MarketplaceFetchResult> {
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: this.options.headless });
      const context = await browser.newContext({
        locale: 'pl-PL',
        timezoneId: 'Europe/Warsaw',
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
      });
      const searchPage = await context.newPage();
      const search = await this.collectSearchLinks(searchPage, searchUrl);
      const links = search.links;
      logger.info({ source: this.name, count: links.length }, 'Discovered listing links');

      const results: RawListing[] = [];
      let errors = search.truncated ? 1 : 0;
      let nextIndex = 0;
      const worker = async () => {
        const detailPage = await context.newPage();
        try {
          while (nextIndex < links.length) {
            const index = nextIndex++;
            const url = links[index];
            if (!url) continue;
            try {
              await detailPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
              const payload = await extractPayload(detailPage, this.publicationDateSelectors());
              const scrapedAt = new Date().toISOString();
              results.push({
                source: this.name,
                externalId: this.externalId(new URL(url)),
                url,
                title: payload.title,
                description: payload.description,
                declaredSellerType: payload.declaredSellerType,
                publishedAt: parseMarketplacePublishedAt(payload.publicationDateText, scrapedAt),
                attributes: payload.attributes,
                ...(payload.priceText ? { priceText: payload.priceText } : {}),
                ...(payload.location ? { location: payload.location } : {}),
                ...(payload.sellerName ? { sellerName: payload.sellerName } : {}),
                ...(payload.primaryImageUrl ? { primaryImageUrl: payload.primaryImageUrl } : {}),
                scrapedAt,
              });
            } catch (error) {
              errors += 1;
              logger.warn(
                { source: this.name, url, err: error },
                'Could not parse listing; continuing',
              );
            }
          }
        } finally {
          await detailPage.close();
        }
      };
      const workerCount = Math.min(this.options.detailConcurrency, links.length);
      await Promise.all(Array.from({ length: workerCount }, worker));
      return { listings: results, errors };
    } finally {
      await browser?.close();
    }
  }

  private async collectSearchLinks(
    page: Page,
    searchUrl: string,
  ): Promise<{ links: string[]; truncated: boolean }> {
    const links = new Set<string>();
    const visitedPages = new Set<string>();
    let nextUrl: string | null = searchUrl;

    while (
      nextUrl &&
      visitedPages.size < this.options.maxSearchPages &&
      links.size < this.options.maxListings
    ) {
      if (visitedPages.has(nextUrl)) break;
      visitedPages.add(nextUrl);
      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await this.acceptConsentIfPresent(page);
      await page.waitForTimeout(750);
      for (const link of await this.collectLinks(page)) links.add(link);
      nextUrl = await this.findNextPageUrl(page);
    }

    logger.info(
      { source: this.name, searchPages: visitedPages.size, listingLinks: links.size },
      'Search pagination completed',
    );
    const truncated = nextUrl !== null || links.size > this.options.maxListings;
    if (truncated) {
      logger.warn(
        {
          source: this.name,
          maxListings: this.options.maxListings,
          maxSearchPages: this.options.maxSearchPages,
        },
        'Search results hit a safety limit; baseline cannot be marked complete',
      );
    }
    return { links: [...links].slice(0, this.options.maxListings), truncated };
  }

  private async collectLinks(page: Page): Promise<string[]> {
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
    return [
      ...new Set(
        hrefs.filter((href) => {
          try {
            return this.matchesListingUrl(new URL(href));
          } catch {
            return false;
          }
        }),
      ),
    ];
  }

  private async acceptConsentIfPresent(page: Page): Promise<void> {
    const consent = page.getByRole('button', { name: /akceptuj|zgadzam|accept all|accept/i });
    if (
      await consent
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await consent
        .first()
        .click()
        .catch(() => undefined);
    }
  }

  private async findNextPageUrl(page: Page): Promise<string | null> {
    const selectors = [
      'a[rel="next"]',
      'a[aria-label*="następ" i]',
      'a[aria-label*="next" i]',
      'a[data-testid*="pagination-forward"]',
    ];
    for (const selector of selectors) {
      const href = await page
        .locator(selector)
        .first()
        .getAttribute('href', { timeout: 250 })
        .catch(() => null);
      if (href) return new URL(href, page.url()).toString();
    }
    const textLink = page.getByRole('link', { name: /następna|dalej|next/i }).first();
    const href = await textLink.getAttribute('href', { timeout: 250 }).catch(() => null);
    if (href) return new URL(href, page.url()).toString();

    // OLX exposes only numbered page anchors (2, 3, ...), without rel=next.
    const currentUrl = new URL(page.url());
    const currentPageNumber = Number(currentUrl.searchParams.get('page') ?? '1');
    const numberedPageUrls = await page
      .locator('a[href*="page="]')
      .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
    const nextNumberedPage = numberedPageUrls
      .map((candidate) => new URL(candidate, page.url()))
      .filter(
        (candidate) =>
          candidate.origin === currentUrl.origin && candidate.pathname === currentUrl.pathname,
      )
      .map((candidate) => ({ candidate, page: Number(candidate.searchParams.get('page')) }))
      .filter(({ page: candidatePage }) =>
        Number.isFinite(candidatePage) ? candidatePage > currentPageNumber : false,
      )
      .sort((left, right) => left.page - right.page)[0]?.candidate;
    if (nextNumberedPage) return nextNumberedPage.toString();

    // Otomoto renders pagination as buttons and updates the `page` query
    // parameter client-side, so there is no anchor href to collect.
    const nextButton = page
      .getByRole('button', { name: /go to next page|następna strona/i })
      .first();
    const canAdvance = await nextButton.isEnabled({ timeout: 250 }).catch(() => false);
    if (!canAdvance) return null;
    const nextPage = new URL(page.url());
    const currentPage = Number(nextPage.searchParams.get('page') ?? '1');
    nextPage.searchParams.set('page', String(Number.isFinite(currentPage) ? currentPage + 1 : 2));
    return nextPage.toString();
  }
}

async function extractPayload(page: Page, publicationSelectors: string[]): Promise<PagePayload> {
  return page.evaluate((sourcePublicationSelectors) => {
    // Object methods retain their names without tsx/esbuild injecting the
    // Node-side `__name` helper into code serialized for the browser context.
    const helpers = {
      clean(value?: string | null) {
        return value?.replace(/\s+/g, ' ').trim() ?? '';
      },
      meta(selector: string) {
        return this.clean(document.querySelector<HTMLMetaElement>(selector)?.content);
      },
      publicationValue(element?: Element | null) {
        if (!element) return '';
        return this.clean(
          element.getAttribute('datetime') ??
            element.getAttribute('content') ??
            element.getAttribute('data-date') ??
            element.textContent,
        );
      },
    };
    const jsonLd = [
      ...document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
    ]
      .flatMap((script) => {
        try {
          const parsed: unknown = JSON.parse(script.textContent ?? 'null');
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return [];
        }
      })
      .flatMap((item: any) => (Array.isArray(item?.['@graph']) ? item['@graph'] : [item]))
      .find((item: any) =>
        ['Vehicle', 'Car', 'Product'].includes(String(item?.['@type'] ?? '')),
      ) as Record<string, any> | undefined;

    const attributes: Record<string, string> = {};
    for (const row of document.querySelectorAll('dt, [data-testid*="parameter"], li')) {
      let label = '';
      let value = '';
      if (row.tagName === 'DT') {
        label = helpers.clean(row.textContent);
        value = helpers.clean(row.nextElementSibling?.textContent);
      } else {
        const parts = [...row.children]
          .map((child) => helpers.clean(child.textContent))
          .filter(Boolean);
        if (parts.length >= 2) {
          label = parts[0] ?? '';
          value = parts.at(-1) ?? '';
        }
      }
      if (label && value && label !== value && label.length < 80 && value.length < 200) {
        attributes[label] = value;
      }
    }
    const knownLabels = [
      'Rok produkcji',
      'Przebieg',
      'Rodzaj paliwa',
      'Paliwo',
      'Typ nadwozia',
      'Nadwozie',
      'Pojemność skokowa',
      'Moc',
      'Skrzynia biegów',
      'Napęd',
    ];
    for (const element of document.querySelectorAll('p, div, dt')) {
      const label = helpers.clean(element.textContent);
      if (!knownLabels.includes(label) || attributes[label]) continue;
      let container = element.parentElement;
      for (let depth = 0; depth < 2 && container; depth++, container = container.parentElement) {
        const combined = helpers.clean(container.textContent);
        const value = combined.replace(label, '').trim();
        if (value && value.length < 150) {
          attributes[label] = value;
          break;
        }
      }
    }
    const additionalProperties = Array.isArray(jsonLd?.additionalProperty)
      ? jsonLd.additionalProperty
      : [];
    for (const property of additionalProperties) {
      const label = helpers.clean(String(property?.name ?? ''));
      const value = helpers.clean(String(property?.value ?? ''));
      if (label && value) attributes[label] = value;
    }
    if (jsonLd?.vehicleModelDate ?? jsonLd?.productionDate)
      attributes['Rok produkcji'] = String(jsonLd.vehicleModelDate ?? jsonLd.productionDate);
    if (jsonLd?.mileageFromOdometer?.value)
      attributes['Przebieg'] = String(jsonLd.mileageFromOdometer.value);
    if (jsonLd?.fuelType) attributes['Rodzaj paliwa'] = String(jsonLd.fuelType);
    if (jsonLd?.vehicleTransmission)
      attributes['Skrzynia biegów'] = String(jsonLd.vehicleTransmission);
    if (jsonLd?.vehicleEngine?.engineDisplacement?.value)
      attributes['Pojemność'] = String(jsonLd.vehicleEngine.engineDisplacement.value);
    if (jsonLd?.vehicleEngine?.enginePower?.value)
      attributes['Moc'] = String(jsonLd.vehicleEngine.enginePower.value);
    if (jsonLd?.vehicleIdentificationNumber)
      attributes['VIN'] = String(jsonLd.vehicleIdentificationNumber);
    const brand =
      typeof jsonLd?.brand === 'string'
        ? jsonLd.brand
        : typeof jsonLd?.brand?.name === 'string'
          ? jsonLd.brand.name
          : '';
    if (brand) attributes['Marka pojazdu'] = brand;
    if (jsonLd?.model) attributes['Model pojazdu'] = String(jsonLd.model);
    if (jsonLd?.bodyType) attributes['Typ nadwozia'] = String(jsonLd.bodyType);

    const offer = jsonLd?.offers;
    const price = Array.isArray(offer)
      ? (offer[0]?.price ?? offer[0]?.priceSpecification?.price)
      : (offer?.price ?? offer?.priceSpecification?.price);
    const image = Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image;
    const seller = Array.isArray(offer) ? offer[0]?.seller : offer?.seller;
    const sellerText = helpers.clean(seller?.name);
    const rawBodyText = document.body.innerText;
    const bodyText = helpers.clean(rawBodyText);
    const structuredPublicationDate = helpers.clean(
      String(
        jsonLd?.datePosted ??
          jsonLd?.datePublished ??
          jsonLd?.uploadDate ??
          jsonLd?.offers?.datePosted ??
          '',
      ),
    );
    const selectorPublicationDate = sourcePublicationSelectors
      .map((selector) => helpers.publicationValue(document.querySelector(selector)))
      .find(Boolean);
    const visiblePublicationDate = rawBodyText.match(
      /(?:Opublikowano|Dodane|Wystawiono)\s*:?\s*((?:dzisiaj|wczoraj)(?:\s*,?\s*(?:o\s*)?\d{1,2}:\d{2})?|\d{1,2}[./-]\d{1,2}[./-]\d{4}(?:\s*,?\s*(?:o\s*)?\d{1,2}:\d{2})?|\d{1,2}\s+[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]+\s+\d{4}(?:\s*,?\s*(?:o\s*)?\d{1,2}:\d{2})?)/i,
    )?.[1];
    const visibleParameters: Array<[string, RegExp]> = [
      ['Rok produkcji', /Rok produkcji:\s*([^\n]+)/i],
      ['Przebieg', /Przebieg:\s*([^\n]+)/i],
      ['Rodzaj paliwa', /(?:Rodzaj paliwa|Paliwo):\s*([^\n]+)/i],
      ['Typ nadwozia', /(?:Typ nadwozia|Nadwozie):\s*([^\n]+)/i],
      ['Pojemność', /(?:Poj\. silnika|Pojemność skokowa|Pojemność):\s*([^\n]+)/i],
      ['Moc', /(?:Moc silnika|Moc):\s*([^\n]+)/i],
      ['Skrzynia biegów', /Skrzynia biegów:\s*([^\n]+)/i],
      ['Napęd', /Napęd:\s*([^\n]+)/i],
    ];
    for (const [label, pattern] of visibleParameters) {
      const value = rawBodyText.match(pattern)?.[1];
      if (value) attributes[label] = helpers.clean(value);
    }
    const declaredSellerType: SellerType = /firma|dealer|profesjonalny/i.test(bodyText)
      ? 'dealer'
      : /osoba prywatna|prywatny/i.test(bodyText)
        ? 'private'
        : 'uncertain';

    return {
      title:
        helpers.clean(jsonLd?.name) ||
        helpers.meta('meta[property="og:title"]') ||
        helpers.clean(document.title),
      description:
        helpers.clean(jsonLd?.description) ||
        helpers.meta('meta[property="og:description"]') ||
        helpers.meta('meta[name="description"]'),
      priceText: price ? String(price) : undefined,
      location:
        helpers.clean(
          jsonLd?.itemOffered?.availableAtOrFrom?.address?.addressLocality ??
            jsonLd?.offers?.areaServed?.name,
        ) || undefined,
      sellerName: sellerText || undefined,
      declaredSellerType,
      primaryImageUrl:
        helpers.clean(image) || helpers.meta('meta[property="og:image"]') || undefined,
      publicationDateText:
        structuredPublicationDate || selectorPublicationDate || visiblePublicationDate || undefined,
      attributes,
    };
  }, publicationSelectors);
}
