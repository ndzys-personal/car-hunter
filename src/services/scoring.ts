import type {
  DeterministicScore,
  Listing,
  ScoreBreakdown,
  SearchProfile,
} from '../domain/types.js';
import { inferEngine } from './engine-inference.js';
import { scoreFreshness } from './freshness.js';
import { detectSellerType, scoreSellerAssessment } from './seller-detection.js';

export function scoreListing(listing: Listing, profile: SearchProfile): DeterministicScore {
  const reasons: string[] = [];
  const profileFit = scoreProfileFit(listing, profile, reasons);
  const bodyStyleBonus =
    listing.bodyType === 'Touring' ? profile.preferences.touringPracticalityBonus : 0;
  const variant = listing.variant && profile.variants.includes(listing.variant) ? 10 : 0;
  const year = scoreYear(listing.year, profile, reasons);
  const price = scorePrice(listing.pricePln, profile, reasons);
  const inferred = inferEngine(listing);
  const engine = scoreEngine(inferred.engine, inferred.confidence, profile);
  const transmission = listing.gearbox === 'unknown' ? 0 : 3;
  const drivetrain =
    listing.driveType === 'rwd'
      ? profile.preferences.rwdBonus
      : listing.driveType === 'awd'
        ? -profile.preferences.awdPenalty
        : 0;
  const sellerAssessment = detectSellerType(listing);
  const seller = scoreSellerAssessment(sellerAssessment, profile.preferences.seller);
  const dataQuality = scoreDataQuality(listing);
  const freshness = scoreFreshness(listing, profile);
  const breakdown: ScoreBreakdown = {
    profileFit,
    bodyStyleBonus,
    variant,
    year,
    price,
    engine,
    transmission,
    drivetrain,
    seller,
    dataQuality,
    freshness,
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
  if (engine >= 6) reasons.push(`Silnik ${inferred.engine} pasuje do preferencji.`);
  if (listing.bodyType === 'Touring') reasons.push('Touring: mały bonus za praktyczność.');
  if (listing.driveType === 'rwd') reasons.push('RWD jest zgodne z preferencjami.');
  if (listing.driveType === 'awd') reasons.push('xDrive: kara za dodatkową złożoność napędu.');
  if (freshness > 0) reasons.push(`Świeże ogłoszenie: mały bonus +${freshness}.`);
  if (seller > 0) reasons.push('Profil sprzedającego wygląda na prywatny.');
  if (seller < 0)
    reasons.push('Profil sprzedającego wymaga większej ostrożności jak przy handlarzu.');

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
  if (price === null) return 2;
  if (price <= profile.pricePln.idealMax) return 15;
  if (price <= profile.pricePln.hardMax) {
    const span = profile.pricePln.hardMax - profile.pricePln.idealMax;
    const penalty = Math.round(((price - profile.pricePln.idealMax) / span) * 7);
    reasons.push('Cena przekracza limit idealny, ale mieści się w limicie twardym.');
    return Math.max(8, 15 - penalty);
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
    breakdown.bodyStyleBonus +
    breakdown.variant +
    breakdown.year +
    breakdown.price +
    breakdown.engine +
    breakdown.transmission +
    breakdown.drivetrain +
    breakdown.seller +
    breakdown.dataQuality +
    breakdown.freshness
  );
}

function scoreEngine(
  engine: ReturnType<typeof inferEngine>['engine'],
  confidence: number,
  profile: SearchProfile,
): number {
  if (engine === 'unknown') return 0;
  if (engine === 'N52B30_or_N53B30') return 2;
  return profile.preferredEngines.includes(engine) ? Math.round(8 * confidence) : 0;
}
