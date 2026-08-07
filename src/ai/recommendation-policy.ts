import type {
  DeterministicScore,
  EngineCode,
  Listing,
  ListingAnalysis,
  SearchProfile,
} from '../domain/types.js';
import { inferEngine, type EngineInference } from '../services/engine-inference.js';
import type { RawListingAnalysis } from './schema.js';

const serviceEvidencePattern =
  /faktur|rachunk|ASO|wymian[ay].{0,30}(oleju|pompy|rozrządu|skrzyni)|serwis.{0,20}\d{2,3}\s?000/i;
const neutralOrNegativePositivePattern = /xdrive|\bawd\b|4x4|m[- ]?pakiet/i;
const unsupportedMarketClaimPattern =
  /(atrakcyjn|korzystn|okazyjn|tani|niska cena).{0,50}(rynk|ofert|konkurenc)|(rynk|ofert|konkurenc).{0,50}(atrakcyjn|korzystn|okazyjn|tani)/i;

export function applyRecommendationPolicy(
  raw: RawListingAnalysis,
  listing: Listing,
  profile: SearchProfile,
  deterministicScore: DeterministicScore,
): ListingAnalysis {
  const inferredEngine = inferEngine(listing);
  const engine = reconcileEngine(raw, inferredEngine);
  const hasServiceEvidence = serviceEvidencePattern.test(listing.description);
  const sellerConfidence =
    raw.sellerInferredType === 'private'
      ? Math.min(raw.sellerConfidence, 0.7)
      : raw.sellerConfidence;
  const sellerSignals = unique([
    ...(listing.declaredSellerType === 'private'
      ? ['Deklaracja platformy: osoba prywatna']
      : listing.declaredSellerType === 'dealer'
        ? ['Deklaracja platformy: firma/dealer']
        : []),
    ...raw.sellerSignals,
  ]).slice(0, 8);
  const majorUncertainties = unique([
    ...raw.majorUncertainties,
    ...(listing.vin ? [] : ['Brak VIN lub dekodowania VIN.']),
    ...(engine.engine === 'unknown' || engine.engine === 'N52B30_or_N53B30'
      ? ['Dokładny kod silnika wymaga potwierdzenia po VIN.']
      : []),
    ...(!hasServiceEvidence ? ['Brak udokumentowanej historii serwisowej w ogłoszeniu.'] : []),
  ]).slice(0, 8);
  const positives = raw.positives
    .filter(
      (item) =>
        !neutralOrNegativePositivePattern.test(item) &&
        !unsupportedMarketClaimPattern.test(item) &&
        !(
          ['unknown', 'N52B30_or_N53B30'].includes(engine.engine) &&
          /silnik|3[.,]0|218\s*KM/i.test(item)
        ),
    )
    .slice(0, 8);
  const redFlags = unique([
    ...normalizeMileageLanguage(
      raw.redFlags.filter(
        (item) => listing.driveType !== 'awd' || !/xdrive|\bawd\b|4x4/i.test(item),
      ),
      listing,
    ),
    ...(listing.driveType === 'awd'
      ? ['xDrive zwiększa złożoność napędu i potencjalne koszty serwisu.']
      : []),
  ]).slice(0, 8);
  const verificationItems = buildVerificationItems(
    raw.verificationItems,
    listing,
    engine.engine,
    hasServiceEvidence,
  );
  const analysisConfidence = Math.min(raw.analysisConfidence, engine.confidence < 0.7 ? 0.79 : 1);
  let totalScore = clamp(
    Math.round(deterministicScore.totalScore * 0.7 + raw.fitScore * 0.3 - raw.riskScore * 0.2),
  );
  if (analysisConfidence < 0.8 || engine.confidence < 0.8 || majorUncertainties.length > 0)
    totalScore = Math.min(totalScore, 89);

  const missingKeyInformation =
    !listing.vin ||
    !hasServiceEvidence ||
    engine.engine === 'unknown' ||
    engine.engine === 'N52B30_or_N53B30' ||
    engine.confidence < 0.75;
  const recommendedAction =
    raw.recommendedAction === 'inspect' && missingKeyInformation ? 'call' : raw.recommendedAction;

  return {
    ...raw,
    sellerDeclaredType: listing.declaredSellerType,
    sellerConfidence,
    sellerSignals,
    likelyEngine: engine.engine,
    engineConfidence: engine.confidence,
    analysisConfidence,
    majorUncertainties,
    totalScore,
    priceAssessment: assessPriceAgainstBudget(listing.pricePln, profile),
    positives,
    redFlags,
    verificationItems,
    summary: normalizeAmbiguousEngineNarrative(
      normalizeMileageNarrative(removeUnsupportedMarketClaims(raw.summary), listing),
      engine.engine,
    ),
    verdict: normalizeAmbiguousEngineNarrative(
      normalizeMileageNarrative(removeUnsupportedMarketClaims(raw.verdict), listing),
      engine.engine,
    ),
    recommendedAction,
  };
}

export function assessPriceAgainstBudget(pricePln: number | null, profile: SearchProfile): string {
  if (pricePln === null) return 'Brak ceny — trzeba ją potwierdzić ze sprzedawcą.';
  if (pricePln <= profile.pricePln.hardMax) return 'Cena mieści się w budżecie.';
  return 'Cena przekracza ustalony budżet.';
}

function reconcileEngine(
  raw: RawListingAnalysis,
  inferred: EngineInference,
): { engine: EngineCode; confidence: number } {
  const explicitCode = inferred.evidence.some((item) => item.startsWith('Kod '));
  if (explicitCode) {
    return {
      engine: inferred.engine,
      confidence: Math.min(raw.engineConfidence, inferred.confidence),
    };
  }
  if (inferred.engine === 'N52B30_or_N53B30') {
    return { engine: inferred.engine, confidence: Math.min(raw.engineConfidence, 0.7) };
  }
  if (inferred.engine === 'unknown') {
    return { engine: 'unknown', confidence: Math.min(raw.engineConfidence, 0.4) };
  }
  return {
    engine: inferred.engine,
    confidence: Math.min(raw.engineConfidence, inferred.confidence, 0.7),
  };
}

function buildVerificationItems(
  supplied: string[],
  listing: Listing,
  engine: EngineCode,
  hasServiceEvidence: boolean,
): string[] {
  const derived = [
    ...(engine === 'unknown' || engine === 'N52B30_or_N53B30'
      ? ['Potwierdzić dokładny kod silnika po VIN.']
      : []),
    ...(!hasServiceEvidence ? ['Poprosić o faktury i historię serwisową.'] : []),
    ...(listing.driveType === 'awd' ? ['Potwierdzić serwis xDrive i zgodność opon.'] : []),
    ...(listing.gearbox === 'automatic' ? ['Potwierdzić serwis oleju w skrzyni biegów.'] : []),
    ...(listing.fuelType === 'petrol' ? ['Sprawdzić historię wymiany pompy wody.'] : []),
  ];
  const items = unique([...derived, ...supplied]).slice(0, 4);
  if (items.length < 2) items.push('Zweryfikować VIN i zgodność danych z ogłoszeniem.');
  if (items.length < 2) items.push('Ustalić zakres ostatniego dużego serwisu.');
  return items.slice(0, 4);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeMileageLanguage(items: string[], listing: Listing): string[] {
  const highMileage =
    listing.mileageKm !== null && listing.mileageKm >= 280_000 && listing.mileageKm <= 320_000;
  const suspiciouslyLowMileage =
    listing.year !== null &&
    listing.year <= 2010 &&
    listing.mileageKm !== null &&
    listing.mileageKm < 120_000 &&
    !serviceEvidencePattern.test(listing.description);
  const normalized = items.map((item) =>
    highMileage && /przebieg|kilometr/i.test(item)
      ? 'Przy tym przebiegu szczególnie ważna jest udokumentowana historia obsługi.'
      : item,
  );
  if (suspiciouslyLowMileage) {
    normalized.push('Niski przebieg bez historii wymaga potwierdzenia dokumentami.');
  }
  return normalized;
}

function removeUnsupportedMarketClaims(value: string): string {
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !unsupportedMarketClaimPattern.test(sentence));
  return sentences.join(' ').trim() || 'Ocena wymaga weryfikacji informacji ze sprzedawcą.';
}

function normalizeMileageNarrative(value: string, listing: Listing): string {
  const highMileage =
    listing.mileageKm !== null && listing.mileageKm >= 280_000 && listing.mileageKm <= 320_000;
  if (!highMileage) return value;
  return value.replace(
    /wysoki przebieg/gi,
    `przebieg ${listing.mileageKm!.toLocaleString('pl-PL')} km, przy którym kluczowa jest udokumentowana obsługa`,
  );
}

function normalizeAmbiguousEngineNarrative(value: string, engine: EngineCode): string {
  if (engine !== 'N52B30_or_N53B30') return value;
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) =>
      /(?:silnik|3[.,]0).{0,80}(?:preferenc|pożądan|atut|zalet)/i.test(sentence)
        ? 'Ogłoszenie wskazuje na silnik 3.0/218 KM, ale dokładny kod N52B30 lub N53B30 wymaga weryfikacji po VIN.'
        : sentence,
    )
    .join(' ');
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
