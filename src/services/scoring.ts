import type {
  DeterministicScore,
  Listing,
  ScoreBreakdown,
  SearchProfile,
} from '../domain/types.js';
import { inferEngine } from './engine-inference.js';

export function scoreListing(listing: Listing, profile: SearchProfile): DeterministicScore {
  const reasons: string[] = [];
  const profileFit = scoreProfileFit(listing, profile, reasons);
  const variant = listing.variant && profile.variants.includes(listing.variant) ? 15 : 0;
  const year = scoreYear(listing.year, profile, reasons);
  const price = scorePrice(listing.pricePln, profile, reasons);
  const inferred = inferEngine(listing);
  const engine =
    inferred.engine === 'unknown' ? 3 : profile.preferredEngines.includes(inferred.engine) ? 10 : 0;
  const transmission = listing.gearbox === 'unknown' ? 2 : 5;
  const seller =
    listing.declaredSellerType === 'dealer' ? 2 : listing.declaredSellerType === 'private' ? 5 : 3;
  const dataQuality = scoreDataQuality(listing);
  const breakdown: ScoreBreakdown = {
    profileFit,
    variant,
    year,
    price,
    engine,
    transmission,
    seller,
    dataQuality,
  };
  const bodyMatches = matchesAllowedBody(listing, profile);
  const generationMatches =
    listing.generation !== null &&
    profile.acceptedGenerations.includes(listing.generation as never);
  const requiredProfileMismatch =
    listing.make !== profile.make || !generationMatches || !bodyMatches;
  const rejected =
    requiredProfileMismatch ||
    (listing.pricePln !== null && listing.pricePln > profile.pricePln.hardMax) ||
    (listing.year !== null &&
      (listing.year < profile.year.min - 1 || listing.year > profile.year.max + 1));

  if (listing.make !== profile.make) reasons.push(`Marka nie pasuje do profilu ${profile.make}.`);
  if (!generationMatches)
    reasons.push(`Nie potwierdzono wymaganej generacji ${profile.acceptedGenerations.join('/')}.`);
  if (!bodyMatches) reasons.push(`Nie potwierdzono nadwozia ${profile.bodyTypes.join('/')}.`);

  if (variant === 0) reasons.push('Nie potwierdzono docelowego wariantu.');
  if (engine === 10) reasons.push(`Silnik ${inferred.engine} pasuje do preferencji.`);

  return {
    totalScore: rejected ? Math.min(49, sum(breakdown)) : Math.min(100, sum(breakdown)),
    rejected,
    reasons,
    breakdown,
  };
}

function scoreProfileFit(listing: Listing, profile: SearchProfile, reasons: string[]): number {
  const text = `${listing.title} ${listing.description}`;
  const bmw = listing.make === 'BMW';
  const generation = profile.acceptedGenerations.some(
    (item) => listing.generation === item || new RegExp(`\\b${item}\\b`, 'i').test(text),
  );
  const bodyMatches = matchesAllowedBody(listing, profile);
  if (!bmw) {
    reasons.push('To nie jest BMW.');
    return 0;
  }
  if (!generation)
    reasons.push(`Nie potwierdzono generacji ${profile.acceptedGenerations.join('/')}.`);
  if (!bodyMatches) reasons.push(`Nie potwierdzono nadwozia ${profile.bodyTypes.join('/')}.`);
  return 10 + (generation ? 10 : 0) + (bodyMatches ? 5 : 0);
}

function matchesAllowedBody(listing: Listing, profile: SearchProfile): boolean {
  const text = `${listing.bodyType ?? ''} ${listing.title} ${listing.description}`;
  return profile.bodyTypes.some((bodyType) =>
    bodyType === 'Touring'
      ? /touring|kombi|combi|station\s*wagon|estate/i.test(text)
      : /sedan|limuzyn/i.test(text),
  );
}

function scoreYear(year: number | null, profile: SearchProfile, reasons: string[]): number {
  if (year === null) return 3;
  if (year >= profile.year.min && year <= profile.year.max) return 10;
  reasons.push(`Rok ${year} jest poza docelowym zakresem.`);
  return year >= profile.year.min - 1 && year <= profile.year.max + 1 ? 4 : 0;
}

function scorePrice(price: number | null, profile: SearchProfile, reasons: string[]): number {
  if (price === null) return 4;
  if (price <= profile.pricePln.idealMax) return 20;
  if (price <= profile.pricePln.hardMax) {
    const span = profile.pricePln.hardMax - profile.pricePln.idealMax;
    const penalty = Math.round(((price - profile.pricePln.idealMax) / span) * 12);
    reasons.push('Cena przekracza limit idealny, ale mieści się w limicie twardym.');
    return Math.max(8, 20 - penalty);
  }
  reasons.push('Cena przekracza twardy limit profilu.');
  return 0;
}

function scoreDataQuality(listing: Listing): number {
  const fields = [
    listing.pricePln,
    listing.year,
    listing.mileageKm,
    listing.variant,
    listing.location,
  ];
  let score = fields.filter((value) => value !== null).length;
  if (listing.description.length >= 250) score += 3;
  else if (listing.description.length >= 80) score += 1;
  if (listing.vin) score += 2;
  return Math.min(10, score);
}

function sum(breakdown: ScoreBreakdown): number {
  return (
    breakdown.profileFit +
    breakdown.variant +
    breakdown.year +
    breakdown.price +
    breakdown.engine +
    breakdown.transmission +
    breakdown.seller +
    breakdown.dataQuality
  );
}
