import type { HistoricalVehicleRecord, SellerType } from '../domain/types.js';
import { normalizeVin } from '../services/vin.js';
import type { VehicleHistoryProvider } from './provider.js';

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** Public, no-auth web search. It honors HTTP errors and never attempts protection bypasses. */
export class PublicWebVehicleHistoryProvider implements VehicleHistoryProvider {
  readonly name = 'public-web';
  readonly version = '1';
  private readonly robotsCache = new Map<string, Promise<RobotsRule[]>>();

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async searchByVin(inputVin: string): Promise<HistoricalVehicleRecord[]> {
    const vin = normalizeVin(inputVin);
    if (!vin) return [];
    const queries = [
      `"${vin}"`,
      `"${vin}" BMW`,
      `"${vin}" OTOMOTO`,
      `"${vin}" OLX`,
      `"${vin}" uszkodzony`,
      `"${vin}" sprzedam`,
      `"${vin}" aukcja`,
    ];
    const hitGroups = await Promise.all(queries.map((query) => this.search(query).catch(() => [])));
    const hits = [...new Map(hitGroups.flat().map((hit) => [hit.url, hit])).values()].slice(0, 12);
    const records = await Promise.all(hits.map((hit) => this.verifyHit(vin, hit)));
    return records.filter((record): record is HistoricalVehicleRecord => record !== null);
  }

  private async search(query: string): Promise<SearchHit[]> {
    const response = await this.fetcher(
      `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
      {
        headers: { 'user-agent': 'CarHunter/1.0 VIN history research; public indexed pages only' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return [];
    const xml = await response.text();
    return [
      ...xml.matchAll(
        /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/gi,
      ),
    ]
      .map((match) => ({
        title: decode(match[1] ?? ''),
        url: decode(match[2] ?? ''),
        snippet: stripHtml(decode(match[3] ?? '')),
      }))
      .filter((hit) => /^https?:\/\//.test(hit.url));
  }

  private async verifyHit(vin: string, hit: SearchHit): Promise<HistoricalVehicleRecord | null> {
    try {
      if (!(await this.robotsAllows(hit.url))) return null;
      const response = await this.fetcher(hit.url, {
        headers: { 'user-agent': 'CarHunter/1.0 VIN history research; public pages only' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html'))
        return null;
      const html = (await response.text()).slice(0, 2_000_000);
      const text = stripHtml(html);
      if (
        !text
          .toUpperCase()
          .replace(/[\s-]+/g, '')
          .includes(vin)
      )
        return null;
      const description = meta(html, 'description') ?? hit.snippet;
      const combined = `${hit.title} ${description} ${text.slice(0, 50_000)}`;
      const observedAt = new Date().toISOString();
      return {
        source: sourceName(response.url || hit.url),
        historicalUrl: response.url || hit.url,
        observedAt,
        publishedAt: extractDate(html),
        pricePln: extractPrice(combined),
        mileageKm: extractMileage(combined),
        title: meta(html, 'og:title') ?? hit.title,
        vehicleModel: null,
        location: null,
        sellerId: null,
        sellerName: extractSeller(combined),
        sellerType: extractSellerType(combined),
        descriptionExcerpt: description.slice(0, 800) || null,
        damageStatus: /uszkodzon|do naprawy|powypadkow|awaria/i.test(combined)
          ? 'damaged'
          : 'unknown',
        runningStatus: /nie odpala|nie jeździ|niesprawn|unieruchomion/i.test(combined)
          ? 'non_running'
          : 'unknown',
        vinConfirmed: true,
        confidence: extractDate(html) ? 'high' : 'medium',
        evidenceUrl: response.url || hit.url,
        origin: 'external',
      };
    } catch {
      return null;
    }
  }

  private async robotsAllows(value: string): Promise<boolean> {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    let pending = this.robotsCache.get(url.origin);
    if (!pending) {
      pending = this.readRobots(url.origin);
      this.robotsCache.set(url.origin, pending);
    }
    const matches = (await pending)
      .filter((rule) => url.pathname.startsWith(rule.path))
      .sort((left, right) => right.path.length - left.path.length);
    return matches[0]?.allow ?? true;
  }

  private async readRobots(origin: string): Promise<RobotsRule[]> {
    try {
      const response = await this.fetcher(`${origin}/robots.txt`, {
        headers: { 'user-agent': 'CarHunter/1.0 VIN history research' },
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok ? parseWildcardRobots(await response.text()) : [];
    } catch {
      return [];
    }
  }
}

interface RobotsRule {
  allow: boolean;
  path: string;
}

function parseWildcardRobots(text: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let applies = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') applies = value === '*';
    else if (applies && (field === 'allow' || field === 'disallow') && value)
      rules.push({ allow: field === 'allow', path: value.replace(/\*.*$/, '') || '/' });
  }
  return rules;
}

function meta(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["']`, 'i'),
  ];
  return decode(patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean) ?? '') || null;
}
function extractDate(html: string): string | null {
  const raw =
    meta(html, 'article:published_time') ??
    meta(html, 'datePublished') ??
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1];
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function extractPrice(text: string): number | null {
  const raw = text.match(/(\d{1,3}(?:[ .]\d{3})+|\d{4,6})\s*(?:PLN|zł)/i)?.[1];
  return raw ? Number(raw.replace(/[ .]/g, '')) : null;
}
function extractMileage(text: string): number | null {
  const raw = text.match(/(\d{1,3}(?:[ .]\d{3})+|\d{4,6})\s*km\b/i)?.[1];
  return raw ? Number(raw.replace(/[ .]/g, '')) : null;
}
function extractSeller(text: string): string | null {
  return text.match(/(?:sprzedający|seller)\s*[:-]\s*([^|,\n]{2,80})/i)?.[1]?.trim() ?? null;
}
function extractSellerType(text: string): SellerType | null {
  if (/firma|dealer|profesjonalny sprzedawca/i.test(text)) return 'dealer';
  if (/osoba prywatna|sprzedawca prywatny/i.test(text)) return 'private';
  return null;
}
function sourceName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toUpperCase();
  } catch {
    return 'WEB';
  }
}
function stripHtml(value: string): string {
  return decode(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();
}
function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .trim();
}
