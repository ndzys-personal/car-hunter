import type {
  HistoricalVehicleRecord,
  Listing,
  VehicleHistoryAnalysis,
  VehicleHistorySignal,
} from '../domain/types.js';
import { sha256 } from '../services/hash.js';

const damagedPattern =
  /\b(uszkodzon\w*|silnik\s+uszkodzon\w*|na części|do naprawy|powypadkow\w*|uszkodzon\w*\s+skrzyni\w*|awari\w*\s+silnik\w*)\b/i;
const nonRunningPattern = /\b(nie odpala|nie jeździ|niesprawn\w*|unieruchomion\w*)\b/i;

export function analyzeVehicleHistory(
  listing: Pick<
    Listing,
    'vin' | 'pricePln' | 'mileageKm' | 'sellerName' | 'sourceSellerId' | 'url' | 'description'
  >,
  inputRecords: HistoricalVehicleRecord[],
  now: Date = new Date(),
  checkedAt: string | null = null,
): VehicleHistoryAnalysis {
  const records = deduplicateRecords(inputRecords)
    .filter((record) => record.vinConfirmed && record.confidence !== 'low')
    .sort((a, b) => recordTime(a) - recordTime(b));
  const currentCandidates = records.filter(
    (record) =>
      canonical(record.historicalUrl) === canonical(listing.url) &&
      record.pricePln === listing.pricePln &&
      record.mileageKm === listing.mileageKm,
  );
  const currentObservation = currentCandidates.sort((a, b) => recordTime(b) - recordTime(a))[0];
  const historical = records.filter((record) => record !== currentObservation);
  const signals: VehicleHistorySignal[] = [];
  const reliableDated = records.filter((record) => record.publishedAt || record.observedAt);
  const earliest = reliableDated[0] ?? null;
  const earliestDate = earliest ? new Date(earliest.publishedAt ?? earliest.observedAt) : null;
  const estimatedDays = earliestDate
    ? Math.max(0, Math.floor((now.getTime() - earliestDate.getTime()) / 86_400_000))
    : null;
  if (estimatedDays !== null && estimatedDays >= 60 && historical.length > 0) {
    signals.push(
      signal(
        'vehicle_listed_for_months',
        'warning',
        'medium',
        `Auto pojawia się w ogłoszeniach od co najmniej ${formatDate(earliestDate!)}.`,
        records,
      ),
    );
  }

  const priceTimeline = [...records.map((record) => record.pricePln), listing.pricePln].filter(
    (value): value is number => value !== null,
  );
  const firstPrice = priceTimeline[0] ?? null;
  const currentPrice = listing.pricePln;
  const priceDropAmount =
    firstPrice !== null && currentPrice !== null && firstPrice > currentPrice
      ? firstPrice - currentPrice
      : null;
  const priceDropPercent =
    priceDropAmount !== null && firstPrice
      ? Math.round((priceDropAmount / firstPrice) * 1000) / 10
      : null;
  const reductions = priceTimeline
    .slice(1)
    .filter((price, index) => price < priceTimeline[index]!).length;
  if (reductions >= 2) {
    signals.push(
      signal(
        'multiple_price_reductions',
        'info',
        'high',
        `Cena była obniżana wielokrotnie; łączny spadek to ${priceDropAmount?.toLocaleString('pl-PL') ?? 0} zł.`,
        records,
      ),
    );
  }

  const mileageRecords = records.filter((record) => record.mileageKm !== null);
  for (let index = 1; index < mileageRecords.length; index += 1) {
    const older = mileageRecords[index - 1]!;
    const newer = mileageRecords[index]!;
    const delta = newer.mileageKm! - older.mileageKm!;
    const days = Math.max(1, (recordTime(newer) - recordTime(older)) / 86_400_000);
    if (delta < -500) {
      signals.push(
        signal(
          'mileage_decrease',
          'strong_warning',
          'high',
          `Przebieg zmalał z ${fmt(older.mileageKm!)} km do ${fmt(newer.mileageKm!)} km — wymaga weryfikacji dokumentami.`,
          [older, newer],
        ),
      );
    } else if (delta > 0 && (delta / days) * 365 > 100_000) {
      signals.push(
        signal(
          'unusually_high_usage',
          'warning',
          'medium',
          `Przebieg wzrósł o ${fmt(delta)} km w około ${Math.round(days)} dni.`,
          [older, newer],
        ),
      );
    } else if (delta >= 0) {
      signals.push(
        signal(
          'mileage_increase_normal',
          'info',
          'high',
          'Przebieg w kolejnych wiarygodnych obserwacjach nie maleje.',
          [older, newer],
        ),
      );
    }
  }
  const latestMileage = mileageRecords.at(-1);
  if (
    latestMileage &&
    listing.mileageKm !== null &&
    listing.mileageKm < latestMileage.mileageKm! - 500
  ) {
    signals.push(
      signal(
        'mileage_decrease',
        'strong_warning',
        'high',
        `Obecny przebieg ${fmt(listing.mileageKm)} km jest niższy niż wcześniejsze ${fmt(latestMileage.mileageKm!)} km.`,
        [latestMileage],
      ),
    );
  }
  if (listing.mileageKm !== null) {
    const mentionedMileages = [
      ...listing.description.matchAll(
        /(?:przebieg(?:\s+(?:auta|pojazdu|wynosi))?|aktualnie)\s*[:-]?\s*(\d{1,3}(?:[ .]\d{3})+)\s*km\b/gi,
      ),
    ].map((match) => Number(match[1]!.replace(/[ .]/g, '')));
    const stale = mentionedMileages.find((value) => Math.abs(value - listing.mileageKm!) > 500);
    if (stale !== undefined) {
      signals.push({
        type: 'stale_mileage_description',
        severity: 'warning',
        confidence: 'medium',
        messagePl: `Opis zawiera przebieg ${fmt(stale)} km, inny niż bieżące ${fmt(listing.mileageKm)} km.`,
        evidenceUrls: [listing.url],
      });
    }
  }

  const descriptions = historical
    .map((record) => record.descriptionExcerpt)
    .filter((v): v is string => Boolean(v));
  if (
    descriptions.some(
      (description) =>
        description.length >= 80 && textSimilarity(description, listing.description) < 0.2,
    )
  ) {
    signals.push({
      type: 'major_description_change',
      severity: 'warning',
      confidence: 'medium',
      messagePl: 'Treść obecnego ogłoszenia istotnie różni się od wcześniejszego opisu tego VIN.',
      evidenceUrls: historical
        .filter((record) => record.descriptionExcerpt)
        .map((record) => record.evidenceUrl),
    });
  }

  for (const record of historical) {
    const text = `${record.title ?? ''} ${record.descriptionExcerpt ?? ''}`;
    if (record.damageStatus === 'damaged' || damagedPattern.test(text)) {
      signals.push(
        signal(
          'previously_damaged',
          'strong_warning',
          record.confidence,
          'Wcześniejsze ogłoszenie opisywało pojazd jako uszkodzony lub wymagający naprawy.',
          [record],
        ),
      );
    }
    if (record.runningStatus === 'non_running' || nonRunningPattern.test(text)) {
      signals.push(
        signal(
          'previously_non_running',
          'strong_warning',
          record.confidence,
          'Wcześniejsze ogłoszenie wskazywało, że pojazd był niesprawny lub nie jeździł.',
          [record],
        ),
      );
    }
  }

  const sellers = new Set(records.map(sellerKey).filter(Boolean));
  const sellerChanged = sellers.size > 1;
  if (sellerChanged) {
    signals.push(
      signal(
        'seller_changed',
        'info',
        'medium',
        'Ten sam VIN pojawił się przy różnych identyfikatorach lub nazwach sprzedających.',
        records,
      ),
    );
  }
  if (!sellerChanged && sellers.size === 1 && estimatedDays !== null && estimatedDays >= 60) {
    signals.push(
      signal(
        'seller_consistency',
        'positive',
        'medium',
        'W obserwowanej historii VIN sprzedający pozostaje spójny.',
        records,
      ),
    );
  }
  const damaged = historical.find(
    (record) =>
      record.damageStatus === 'damaged' ||
      record.runningStatus === 'non_running' ||
      damagedPattern.test(`${record.title ?? ''} ${record.descriptionExcerpt ?? ''}`),
  );
  if (
    damaged &&
    sellerChanged &&
    daysBetween(damaged, now) <= 180 &&
    damaged.pricePln !== null &&
    currentPrice !== null &&
    currentPrice > damaged.pricePln * 1.25
  ) {
    signals.push(
      signal(
        'possible_flip',
        'strong_warning',
        'medium',
        'Sekwencja taniego uszkodzonego ogłoszenia, zmiany sprzedającego i wyższej ceny może wskazywać na naprawę oraz szybką odsprzedaż; nie jest to potwierdzony fakt.',
        [damaged],
      ),
    );
  }

  const uniqueSignals = uniqueSignalsByType(signals);
  const scoreAdjustment = scoreHistory(uniqueSignals);
  const meaningful =
    historical.length > 0 && uniqueSignals.some((item) => item.type !== 'mileage_increase_normal');
  const serious = uniqueSignals.some((item) => item.severity === 'strong_warning');
  return {
    vin: listing.vin,
    earliestKnownListing: earliestDate?.toISOString() ?? null,
    listedSinceAt: earliestDate?.toISOString() ?? null,
    estimatedDaysOnMarket: estimatedDays,
    previousListings: historical,
    currentPrice,
    previousPrices: records.map((record) => record.pricePln).filter((v): v is number => v !== null),
    priceDropAmount,
    priceDropPercent,
    historySignals: uniqueSignals,
    scoreAdjustment,
    meaningful,
    serious,
    checkedAt,
    fingerprint: sha256({
      records,
      signals: uniqueSignals,
      currentPrice,
      mileage: listing.mileageKm,
    }),
  };
}

function scoreHistory(signals: VehicleHistorySignal[]): number {
  let adjustment = 0;
  if (signals.some((s) => s.type === 'mileage_decrease')) adjustment -= 25;
  if (signals.some((s) => s.type === 'previously_damaged' || s.type === 'previously_non_running'))
    adjustment -= 20;
  if (signals.some((s) => s.type === 'possible_flip')) adjustment -= 10;
  if (signals.some((s) => s.type === 'multiple_price_reductions')) adjustment -= 2;
  if (signals.some((s) => s.type === 'vehicle_listed_for_months')) adjustment -= 2;
  return Math.max(-45, adjustment);
}

function signal(
  type: VehicleHistorySignal['type'],
  severity: VehicleHistorySignal['severity'],
  confidence: VehicleHistorySignal['confidence'],
  messagePl: string,
  records: HistoricalVehicleRecord[],
): VehicleHistorySignal {
  return {
    type,
    severity,
    confidence,
    messagePl,
    evidenceUrls: [...new Set(records.map((r) => r.evidenceUrl).filter(Boolean))],
  };
}
function recordTime(record: HistoricalVehicleRecord): number {
  // A marketplace publication date describes the listing, not a later price/mileage snapshot.
  // Internal chronology therefore uses captured/observed time; external archived pages use their
  // explicit publication date when one was verified.
  return new Date(
    record.origin === 'internal' ? record.observedAt : (record.publishedAt ?? record.observedAt),
  ).getTime();
}
function daysBetween(record: HistoricalVehicleRecord, now: Date): number {
  return Math.abs(now.getTime() - recordTime(record)) / 86_400_000;
}
function sellerKey(record: HistoricalVehicleRecord): string {
  return record.sellerId ?? record.sellerName?.toLocaleLowerCase('pl').trim() ?? '';
}
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pl-PL').format(date);
}
function fmt(value: number): string {
  return value.toLocaleString('pl-PL');
}
function canonical(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}
function deduplicateRecords(records: HistoricalVehicleRecord[]): HistoricalVehicleRecord[] {
  const map = new Map<string, HistoricalVehicleRecord>();
  for (const r of records) {
    const key = [
      canonical(r.historicalUrl),
      r.publishedAt,
      r.pricePln,
      r.mileageKm,
      sellerKey(r),
      r.descriptionExcerpt,
    ].join(':');
    const existing = map.get(key);
    if (!existing || recordTime(r) < recordTime(existing)) map.set(key, r);
  }
  return [...map.values()];
}
function uniqueSignalsByType(signals: VehicleHistorySignal[]): VehicleHistorySignal[] {
  const order = { strong_warning: 4, warning: 3, positive: 2, info: 1 };
  const map = new Map<string, VehicleHistorySignal>();
  for (const item of signals) {
    const old = map.get(item.type);
    if (!old || order[item.severity] > order[old.severity]) map.set(item.type, item);
  }
  return [...map.values()];
}
function textSimilarity(left: string, right: string): number {
  const words = (value: string) =>
    new Set(value.toLocaleLowerCase('pl').match(/[a-ząćęłńóśźż0-9]{4,}/g) ?? []);
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 1;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / Math.min(a.size, b.size);
}
