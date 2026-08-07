import { describe, expect, it } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import type { ListingAnalysis, PersistedListing } from '../src/domain/types.js';
import { normalizeListing } from '../src/services/normalization.js';
import { escapeHtml, formatMessage, recommendationLabel } from '../src/telegram/telegram.js';
import { rawListing } from './fixtures.js';

describe('Telegram formatting', () => {
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
});
