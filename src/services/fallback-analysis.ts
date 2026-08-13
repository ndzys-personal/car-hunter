import type { DeterministicScore, ListingAnalysis, PersistedListing } from '../domain/types.js';
import { inferEngine } from './engine-inference.js';
import { detectSellerType } from './seller-detection.js';

/**
 * Keeps new-listing notifications flowing when AI or optional enrichment is unavailable.
 * The deliberately low confidence makes it clear that this is not an AI assessment.
 */
export function createFallbackAnalysis(
  listing: PersistedListing,
  score: DeterministicScore,
): ListingAnalysis {
  const seller = detectSellerType(listing);
  const engine = inferEngine(listing);
  const recommendedAction = score.rejected ? 'ignore' : score.totalScore >= 70 ? 'call' : 'review';

  return {
    sellerDeclaredType: listing.declaredSellerType,
    sellerInferredType: seller.inferredType,
    sellerConfidence: seller.confidence,
    sellerSignals: seller.signals,
    sellerRiskExplanation: seller.riskExplanation,
    likelyEngine: engine.engine,
    engineConfidence: engine.confidence,
    analysisConfidence: 0,
    majorUncertainties: ['Analiza AI była chwilowo niedostępna.'],
    fitScore: score.totalScore,
    riskScore: 50,
    totalScore: score.totalScore,
    priceAssessment:
      listing.pricePln === null
        ? 'Brak ceny — sprawdź ogłoszenie ręcznie.'
        : 'Ocena ceny wymaga ręcznej weryfikacji.',
    positives: score.reasons.filter((reason) => !/nie |kara|przekracza|poza/i.test(reason)),
    redFlags: score.reasons.filter((reason) => /nie |kara|przekracza|poza/i.test(reason)),
    questionsForSeller: ['Czy ogłoszenie jest nadal aktualne?'],
    verificationItems: ['Sprawdzić VIN i dane ogłoszenia.', 'Zweryfikować historię serwisową.'],
    summary: 'Automatyczna ocena podstawowa; pełna analiza AI była chwilowo niedostępna.',
    verdict: score.rejected
      ? 'Ogłoszenie nie spełnia podstawowych filtrów.'
      : 'Nowe ogłoszenie do ręcznej weryfikacji.',
    recommendedAction,
  };
}
