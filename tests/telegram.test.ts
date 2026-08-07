import { describe, expect, it } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import type { ListingAnalysis, PersistedListing } from '../src/domain/types.js';
import { normalizeListing } from '../src/services/normalization.js';
import { escapeHtml, formatMessage } from '../src/telegram/telegram.js';
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
      sellerType: 'private',
      sellerConfidence: 0.88,
      likelyEngine: 'N52B25',
      engineConfidence: 0.94,
      fitScore: 85,
      riskScore: 20,
      totalScore: 86,
      priceAssessment: 'Cena rozsądna.',
      positives: ['VIN w ogłoszeniu'],
      redFlags: ['Brak faktur'],
      questionsForSeller: ['Czy są faktury?'],
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
  });
});
