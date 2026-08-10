import type {
  DriveType,
  FuelType,
  Gearbox,
  Listing,
  RawListing,
  SearchProfile,
  SellerType,
} from '../domain/types.js';
import { sha256 } from './hash.js';

const attributeAliases: Record<string, string[]> = {
  price: ['cena', 'price'],
  year: ['rok produkcji', 'rok', 'year'],
  mileage: ['przebieg', 'mileage'],
  fuel: ['rodzaj paliwa', 'paliwo', 'fuel type', 'fuel'],
  capacity: ['pojemność skokowa', 'pojemność', 'engine size', 'displacement'],
  power: ['moc', 'power'],
  gearbox: ['skrzynia biegów', 'gearbox', 'transmission'],
  drive: ['napęd', 'drive'],
  body: ['typ nadwozia', 'nadwozie', 'body type'],
  vin: ['vin'],
  seller: ['oferta od', 'sprzedający', 'seller type'],
  make: ['marka pojazdu', 'marka', 'brand', 'make'],
  model: ['model pojazdu', 'model'],
};

export function normalizeListing(raw: RawListing, profile: SearchProfile): Listing {
  const titleAndDescription = `${raw.title} ${raw.description ?? ''}`;
  const pricePln = parsePrice(
    raw.priceText ?? findAttribute(raw.attributes, 'price') ?? '',
    titleAndDescription,
  );
  const year = parseYear(findAttribute(raw.attributes, 'year') ?? titleAndDescription);
  const mileageKm = parseMileage(findAttribute(raw.attributes, 'mileage') ?? '');
  const engineCapacityCc = parseCapacity(findAttribute(raw.attributes, 'capacity') ?? '');
  const powerHp = parsePower(findAttribute(raw.attributes, 'power') ?? '');
  const fuelType = parseFuel(findAttribute(raw.attributes, 'fuel') ?? titleAndDescription);
  const variant = inferVariant(profile, titleAndDescription, fuelType, engineCapacityCc, powerHp);
  const vin = parseVin(findAttribute(raw.attributes, 'vin') ?? titleAndDescription);
  const declaredSellerType =
    raw.declaredSellerType ?? parseSeller(findAttribute(raw.attributes, 'seller') ?? '');
  const make = parseMake(findAttribute(raw.attributes, 'make') ?? titleAndDescription);
  const model = parseModel(findAttribute(raw.attributes, 'model') ?? titleAndDescription);
  const declaredBodyType = findAttribute(raw.attributes, 'body') ?? titleAndDescription;
  const bodyType = inferBodyType(declaredBodyType);
  const generation =
    parseGeneration(titleAndDescription) ??
    inferGeneration(profile, make, model, year, `${titleAndDescription} ${bodyType ?? ''}`);
  const material = {
    pricePln,
    description: compact(raw.description ?? ''),
    vin,
    sellerName: raw.sellerName ?? null,
    attributes: raw.attributes,
  };

  return {
    source: raw.source,
    sourceListingId: raw.externalId,
    profileId: profile.id,
    url: canonicalUrl(raw.url),
    title: compact(raw.title),
    description: compact(raw.description ?? ''),
    pricePln,
    year,
    mileageKm,
    make,
    model,
    generation,
    variant,
    bodyType,
    fuelType,
    engineCapacityCc,
    powerHp,
    gearbox: parseGearbox(findAttribute(raw.attributes, 'gearbox') ?? titleAndDescription),
    driveType: parseDrive(findAttribute(raw.attributes, 'drive') ?? titleAndDescription),
    vin,
    location: raw.location ?? null,
    sellerName: raw.sellerName ?? null,
    sourceSellerId: raw.sourceSellerId ?? null,
    sellerProfileUrl: raw.sellerProfileUrl ? canonicalUrl(raw.sellerProfileUrl) : null,
    declaredSellerType,
    currentActiveVehicleCount: raw.currentActiveVehicleCount ?? null,
    otherVehicleMakes: raw.otherVehicleMakes ?? [],
    otherVehicleIds: raw.otherVehicleIds ?? [],
    sellerAccountAgeText: raw.sellerAccountAgeText ?? null,
    sellerCompanyName: raw.sellerCompanyName ?? null,
    sellerBusinessSignals: raw.sellerBusinessSignals ?? [],
    sellerHistory: {
      currentActiveVehicleCount: raw.currentActiveVehicleCount ?? null,
      historicalVehicleCount: 1,
      uniqueMakesCount: 1,
      firstSeenSellerAt: null,
      lastSeenSellerAt: null,
    },
    primaryImageUrl: raw.primaryImageUrl ?? null,
    publishedAt: raw.publishedAt,
    rawAttributes: raw.attributes,
    materialHash: sha256(material),
    deduplicationKey: buildDeduplicationKey(raw.source, raw.externalId, vin, raw.url),
    scrapedAt: raw.scrapedAt,
  };
}

export function buildDeduplicationKey(
  source: RawListing['source'],
  externalId: string,
  vin: string | null,
  url: string,
): string {
  if (vin) return `vin:${vin}`;
  if (externalId) return `${source}:${externalId}`;
  return `${source}:url:${sha256(canonicalUrl(url)).slice(0, 24)}`;
}

export function canonicalUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_') || ['fbclid', 'gclid', 'search_reason'].includes(key))
      url.searchParams.delete(key);
  }
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function findAttribute(
  attributes: Record<string, string>,
  semanticName: string,
): string | undefined {
  const aliases = attributeAliases[semanticName] ?? [semanticName];
  const entry = Object.entries(attributes).find(([key]) =>
    aliases.some((alias) => key.toLocaleLowerCase('pl').includes(alias)),
  );
  return entry?.[1];
}

function parseNumber(value: string): number | null {
  const numericGroup = value.match(/\d+(?:[ .]\d{3})*(?:,\d+)?/)?.[0] ?? '';
  const normalized = numericGroup.replace(/[ .](?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function parsePrice(primaryValue: string, fallbackText: string): number | null {
  const primary = parseNumber(primaryValue);
  if (primary !== null && primary > 0) return primary;
  const labelledPrice = fallbackText.match(
    /(\d{1,3}(?:[ .]\d{3})*(?:,\d{1,2})?)\s*(?:PLN|zł)\b/i,
  )?.[1];
  return labelledPrice ? parseNumber(labelledPrice) : null;
}

function parseMileage(value: string): number | null {
  const mileage = parseNumber(value);
  if (mileage === null) return null;
  return /\btys\.?\b/i.test(value) ? mileage * 1_000 : mileage;
}

function parseYear(value: string): number | null {
  const match = value.match(/\b(19[89]\d|20[0-2]\d)\b/);
  return match?.[1] ? Number(match[1]) : null;
}

function parseCapacity(value: string): number | null {
  const number = parseNumber(value);
  if (!number) return null;
  if (/\b[1-9][.,]\d\s*l\b/i.test(value))
    return Math.round(Number(value.match(/[1-9][.,]\d/)?.[0].replace(',', '.')) * 1000);
  return number;
}

function parsePower(value: string): number | null {
  const horsepower = value.match(/(\d{2,4})\s*(?:KM|HP|PS)\b/i)?.[1];
  if (horsepower) return Number(horsepower);
  const kilowatts = value.match(/(\d{2,4})\s*kW\b/i)?.[1];
  return kilowatts ? Math.round(Number(kilowatts) * 1.35962) : parseNumber(value);
}

function parseFuel(value: string): FuelType {
  const lower = value.toLocaleLowerCase('pl');
  if (/diesel|olej napędowy|320d|325d|330d|525d|530d/.test(lower)) return 'diesel';
  if (/benzyna.*lpg|lpg/.test(lower)) return 'lpg';
  if (/hybryd/.test(lower)) return 'hybrid';
  if (/elektr/.test(lower)) return 'electric';
  if (/benzyna|320i|325i|330i|525i|530i/.test(lower)) return 'petrol';
  return 'unknown';
}

function inferVariant(
  profile: SearchProfile,
  text: string,
  fuelType: FuelType,
  capacityCc: number | null,
  powerHp: number | null,
): string | null {
  const declared = profile.variants.find((item) => {
    const match = item.match(/^(\d{3})([id])$/i);
    const pattern = match ? `${match[1]}x?${match[2]}` : item;
    return new RegExp(`\\b${pattern}\\b`, 'i').test(text);
  });
  if (declared) return declared;
  if (/\b[35]\d{2}x?[id]\b/i.test(text)) return null;
  if (capacityCc === null || powerHp === null) return null;

  if (fuelType === 'petrol' || fuelType === 'lpg') {
    if (capacityCc >= 1_900 && capacityCc <= 2_100 && powerHp >= 140 && powerHp <= 180)
      return '320i';
    if (
      ((capacityCc >= 2_400 && capacityCc <= 2_600) ||
        (capacityCc >= 2_900 && capacityCc <= 3_100)) &&
      powerHp >= 210 &&
      powerHp <= 225
    )
      return '325i';
    if (capacityCc >= 2_900 && capacityCc <= 3_100 && powerHp >= 255) return '330i';
  }

  if (fuelType === 'diesel') {
    if (capacityCc >= 1_900 && capacityCc <= 2_100) return '320d';
    if (capacityCc >= 2_400 && capacityCc <= 2_600) return '325d';
    if (capacityCc >= 2_900 && capacityCc <= 3_100) return powerHp >= 215 ? '330d' : '325d';
  }
  return null;
}

function parseGearbox(value: string): Gearbox {
  if (/automat|automatic|steptronic/i.test(value)) return 'automatic';
  if (/manual|ręczna|mechaniczna/i.test(value)) return 'manual';
  return 'unknown';
}

function parseDrive(value: string): DriveType {
  if (/xdrive|4x4|awd|\b[35]\d{2}xi\b/i.test(value)) return 'awd';
  if (/rwd|tyln/i.test(value)) return 'rwd';
  if (/fwd|przedn/i.test(value)) return 'fwd';
  return 'unknown';
}

function parseSeller(value: string): SellerType {
  if (/firma|dealer|profesjonal/i.test(value)) return 'dealer';
  if (/prywat/i.test(value)) return 'private';
  return 'uncertain';
}

function parseVin(value: string): string | null {
  return value.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0] ?? null;
}

function isTouring(value: string): boolean {
  return /touring|kombi|combi|station\s*wagon|estate/i.test(value);
}

function isSedan(value: string): boolean {
  return /sedan|limuzyn/i.test(value);
}

function inferBodyType(value: string): 'Touring' | 'Sedan' | null {
  if (isTouring(value)) return 'Touring';
  if (isSedan(value)) return 'Sedan';
  return null;
}

function parseMake(value: string): string {
  return /\bBMW\b/i.test(value) ? 'BMW' : 'unknown';
}

function parseModel(value: string): string {
  if (/seria\s*3|3\s*series|\b3[123][058][id]\b|\b(?:E9[0-3]|F3[01]|G2[01])\b/i.test(value)) {
    return 'Seria 3';
  }
  if (/seria\s*5|5\s*series|\b5[123][05][id]\b|\b(?:E6[01]|F1[01]|G3[01])\b/i.test(value)) {
    return 'Seria 5';
  }
  return 'unknown';
}

function parseGeneration(value: string): string | null {
  return value.toUpperCase().match(/\b(E9[0-3]|E6[01]|F3[01]|F1[01]|G2[01]|G3[01])\b/)?.[1] ?? null;
}

function inferGeneration(
  profile: SearchProfile,
  make: string,
  model: string,
  year: number | null,
  text: string,
): string | null {
  if (make !== 'BMW' || year === null) return null;
  const expectedModel = profile.generation === 'E61' ? 'Seria 5' : 'Seria 3';
  if (model !== expectedModel || year < profile.year.min) return null;
  const safeLastYear = profile.generation === 'E61' ? 2009 : 2011;
  if (year > safeLastYear) return null;
  if (profile.generation === 'E61') {
    if (isTouring(text)) return 'E61';
    if (isSedan(text)) return 'E60';
    return null;
  }
  if (isTouring(text)) return 'E91';
  if (isSedan(text)) return 'E90';
  return null;
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
