import { describe, expect, it } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import type { ListingAnalysis, PersistedListing } from '../src/domain/types.js';
import { analyzeVehicleHistory } from '../src/history/analysis.js';
import { normalizeListing } from '../src/services/normalization.js';
import {
  escapeHtml,
  formatMessage,
  recommendationLabel,
  TelegramService,
} from '../src/telegram/telegram.js';
import { rawListing } from './fixtures.js';

describe('Telegram formatting', () => {
  it('retries a transient Telegram transport failure', async () => {
    let attempts = 0;
    const fetcher = (async () => {
      await Promise.resolve();
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const messageId = await new TelegramService('token', 'chat', fetcher).sendTestMessage();

    expect(messageId).toBe('42');
    expect(attempts).toBe(2);
  });

  it('escapes marketplace-controlled HTML', () => {
    expect(escapeHtml('<b>BMW & "test"</b>')).toBe('&lt;b&gt;BMW &amp; &quot;test&quot;&lt;/b&gt;');
  });

  it('includes the required concise facts and direct source link', () => {
    const base = normalizeListing(rawListing({ title: 'BMW <E91> & Touring' }), searchProfiles[0]!);
    const listing: PersistedListing = {
      ...base,
      id: 'listing-id',
      firstSeenAt: base.scrapedAt,
      lastSeenAt: base.scrapedAt,
      previousMaterialHash: null,
      previousPricePln: null,
      isNew: true,
      materiallyChanged: false,
    };
    const analysis: ListingAnalysis = {
      sellerDeclaredType: 'private',
      sellerInferredType: 'private',
      sellerConfidence: 0.88,
      sellerSignals: ['Deklaracja platformy: osoba prywatna'],
      sellerRiskExplanation: 'Profil wygląda na prywatny.',
      likelyEngine: 'N52B25',
      engineConfidence: 0.94,
      analysisConfidence: 0.86,
      majorUncertainties: [],
      fitScore: 85,
      riskScore: 20,
      totalScore: 86,
      priceAssessment: 'Cena rozsądna.',
      positives: ['VIN w ogłoszeniu'],
      redFlags: ['Brak faktur'],
      questionsForSeller: ['Czy są faktury?'],
      verificationItems: ['Sprawdzić faktury.', 'Potwierdzić VIN.'],
      summary: 'Dobry kandydat.',
      verdict: 'Warto zadzwonić.',
      recommendedAction: 'call',
    };
    const message = formatMessage(listing, analysis, false);
    expect(message).toContain('86/100');
    expect(message).toContain('Model: E91');
    expect(message).toContain('BMW &lt;E91&gt; &amp; Touring');
    expect(message).toContain(`href="${listing.url}"`);
    expect(message).toContain('N52B25 (94%)');
    expect(message).toContain('Sprawdź przed wizytą');
    expect(message).toContain('skontaktuj się ze sprzedawcą');
    expect(message).toContain('Opublikowano:');
    expect(message).toContain('Wykryto:');

    const dealerMessage = formatMessage(
      listing,
      {
        ...analysis,
        sellerInferredType: 'likely_dealer',
        sellerConfidence: 0.84,
      },
      false,
    );
    expect(dealerMessage).toContain('Sprzedający: prawdopodobnie handlarz ⚠️');
    expect(dealerMessage).toContain('Deklaruje: osoba prywatna');
    expect(dealerMessage).toContain('Pewność: 84%');
  });

  it('shows publication and discovery times, including an unavailable publication date', () => {
    const base = normalizeListing(rawListing(), searchProfiles[0]!);
    const listing: PersistedListing = {
      ...base,
      id: 'listing-id',
      firstSeenAt: '2026-08-07T08:00:00.000Z',
      lastSeenAt: '2026-08-07T12:00:00.000Z',
      previousMaterialHash: null,
      previousPricePln: null,
      isNew: true,
      materiallyChanged: false,
    };
    const analysis: ListingAnalysis = {
      sellerDeclaredType: 'private',
      sellerInferredType: 'private',
      sellerConfidence: 0.6,
      sellerSignals: [],
      sellerRiskExplanation: 'Brak wystarczających danych.',
      likelyEngine: 'N52B25',
      engineConfidence: 0.9,
      analysisConfidence: 0.9,
      majorUncertainties: [],
      fitScore: 85,
      riskScore: 20,
      totalScore: 78,
      priceAssessment: 'Cena mieści się w budżecie.',
      positives: [],
      redFlags: [],
      questionsForSeller: [],
      verificationItems: ['Sprawdzić VIN.', 'Sprawdzić faktury.'],
      summary: 'Kandydat.',
      verdict: 'Warto zadzwonić.',
      recommendedAction: 'call',
    };
    const now = new Date('2026-08-07T13:00:00.000Z');
    const known = formatMessage(listing, analysis, false, now);
    expect(known).toContain('🕐 Opublikowano: dzisiaj, 08:30');
    expect(known).toContain('👁 Wykryto: dzisiaj, 10:00');

    const unknown = formatMessage({ ...listing, publishedAt: null }, analysis, false, now);
    expect(unknown).toContain('🕐 Data publikacji: brak danych');
    expect(unknown).toContain('👁 Pierwszy raz wykryto: dzisiaj, 10:00');
  });

  it('uses staged labels and reserves PILNE for high-confidence analyses', () => {
    const analysis: Parameters<typeof recommendationLabel>[0] = {
      totalScore: 95,
      analysisConfidence: 0.9,
      engineConfidence: 0.9,
      likelyEngine: 'N52B25',
      majorUncertainties: [],
    };
    expect(recommendationLabel(analysis)).toContain('PILNE');
    expect(
      recommendationLabel({ ...analysis, likelyEngine: 'unknown', majorUncertainties: [] }),
    ).toContain('BARDZO CIEKAWE');
    expect(recommendationLabel({ ...analysis, totalScore: 89 })).toContain('BARDZO CIEKAWE');
    expect(recommendationLabel({ ...analysis, totalScore: 79 })).toContain('REKOMENDOWANE');
  });

  it('shows material VIN history and omits an empty history section', () => {
    const base = normalizeListing(rawListing(), searchProfiles[0]!);
    const listing: PersistedListing = {
      ...base,
      id: 'listing-id',
      vehicleId: 'vehicle-id',
      firstSeenAt: base.scrapedAt,
      lastSeenAt: base.scrapedAt,
      previousMaterialHash: null,
      previousPricePln: null,
      isNew: true,
      materiallyChanged: false,
    };
    const analysis: ListingAnalysis = {
      sellerDeclaredType: 'private',
      sellerInferredType: 'private',
      sellerConfidence: 0.1,
      sellerSignals: ['Jedno ogłoszenie'],
      sellerRiskExplanation: 'Brak ryzyka.',
      likelyEngine: 'N52B25',
      engineConfidence: 0.9,
      analysisConfidence: 0.9,
      majorUncertainties: [],
      fitScore: 80,
      riskScore: 10,
      totalScore: 78,
      priceAssessment: 'Cena mieści się w budżecie.',
      positives: [],
      redFlags: [],
      questionsForSeller: [],
      verificationItems: ['Sprawdzić VIN.', 'Poprosić o faktury.'],
      summary: 'Kandydat.',
      verdict: 'Warto zadzwonić.',
      recommendedAction: 'call',
    };
    const important = analyzeVehicleHistory(
      listing,
      [
        {
          source: 'OTOMOTO',
          sourceListingId: 'old',
          historicalUrl: 'https://example.com/old',
          observedAt: '2026-05-12T10:00:00Z',
          publishedAt: '2026-05-12T10:00:00Z',
          pricePln: 4_700,
          mileageKm: 250_000,
          title: 'BMW uszkodzone',
          vehicleModel: 'BMW E91',
          location: 'Poznań',
          sellerId: 'old-seller',
          sellerName: 'Jan',
          sellerType: 'private',
          descriptionExcerpt: 'Silnik uszkodzony, nie odpala.',
          damageStatus: 'damaged',
          runningStatus: 'non_running',
          vinConfirmed: true,
          confidence: 'high',
          evidenceUrl: 'https://example.com/old',
          origin: 'external',
        },
      ],
      new Date('2026-08-10T10:00:00Z'),
    );
    expect(formatMessage(listing, analysis, false, important)).toContain('WAŻNA HISTORIA');
    expect(formatMessage(listing, analysis, false, important)).toContain('Poprzednie ogłoszenie');
    expect(
      formatMessage(listing, analysis, false, analyzeVehicleHistory(listing, [])),
    ).not.toContain('HISTORIA OGŁOSZENIA');
  });
});
