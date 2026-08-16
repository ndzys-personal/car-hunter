import { describe, expect, it } from 'vitest';
import {
  canCompleteBaseline,
  isFatalPipelineError,
  isMeaningfulPriceDrop,
  isNotificationEvent,
  shouldAnalyzeListing,
  shouldAttemptTelegram,
  shouldNotify,
} from '../src/jobs/pipeline.js';
import { searchProfiles } from '../src/config/searches.js';
import { normalizeListing } from '../src/services/normalization.js';
import { createFallbackAnalysis } from '../src/services/fallback-analysis.js';
import { rawListing } from './fixtures.js';

describe('price-change notification logic', () => {
  it('allows a meaningful drop and ignores noise', () => {
    expect(isMeaningfulPriceDrop(25_000, 23_900)).toBe(true);
    expect(isMeaningfulPriceDrop(25_000, 24_800)).toBe(false);
    expect(isMeaningfulPriceDrop(null, 24_000)).toBe(false);
  });

  it('notifies every unseen new listing regardless of AI score or action', () => {
    expect(shouldNotify(false)).toBe(true);
    expect(shouldNotify(true)).toBe(false);
  });

  it('runs AI/history only after the deterministic promising-candidate gate', () => {
    const input = {
      mode: 'scan',
      skipAi: false,
      aiAvailable: true,
      isNew: true,
      rejected: true,
      totalScore: 10,
      threshold: 55,
    } as const;
    expect(shouldAnalyzeListing(input)).toBe(false);
    expect(shouldAnalyzeListing({ ...input, isNew: false })).toBe(false);
    expect(shouldAnalyzeListing({ ...input, isNew: false, rejected: false, totalScore: 55 })).toBe(
      true,
    );
    expect(shouldAnalyzeListing({ ...input, skipAi: true })).toBe(false);
    expect(shouldAnalyzeListing({ ...input, aiAvailable: false })).toBe(false);
    expect(shouldAnalyzeListing({ ...input, mode: 'baseline' })).toBe(false);
  });

  it('allows Telegram only for newly discovered listings', () => {
    expect(isNotificationEvent(true)).toBe(true);
    expect(isNotificationEvent(false)).toBe(false);
    expect(isNotificationEvent(false, true)).toBe(true);
  });

  it('never notifies for baseline imports and can notify new post-baseline listings', () => {
    expect(shouldAttemptTelegram('baseline', true)).toBe(false);
    expect(shouldAttemptTelegram('baseline', false)).toBe(false);
    expect(shouldAttemptTelegram('baseline', false, true)).toBe(false);
    expect(shouldAttemptTelegram('scan', false)).toBe(false);
    expect(shouldAttemptTelegram('scan', true)).toBe(true);
    expect(shouldAttemptTelegram('scan', false, true)).toBe(true);
  });

  it('fails fast on database/schema errors instead of reporting a green workflow', () => {
    expect(isFatalPipelineError({ code: '42P10' })).toBe(true);
    expect(isFatalPipelineError({ code: 'PGRST204' })).toBe(true);
    expect(isFatalPipelineError(new TypeError('fetch failed'))).toBe(false);
    expect(isFatalPipelineError({ code: 'ECONNRESET' })).toBe(false);
  });

  it('completes only a full, successful, non-empty baseline', () => {
    const full = { mode: 'baseline', skipAi: false } as const;
    expect(canCompleteBaseline(full, { processed: 1, errors: 0 })).toBe(true);
    expect(canCompleteBaseline({ ...full, source: 'olx' }, { processed: 1, errors: 0 })).toBe(
      false,
    );
    expect(canCompleteBaseline(full, { processed: 1, errors: 1 })).toBe(false);
    expect(canCompleteBaseline(full, { processed: 0, errors: 0 })).toBe(false);
  });

  it('creates a low-confidence fallback when AI cannot analyze a new listing', () => {
    const normalized = normalizeListing(rawListing(), searchProfiles[0]!);
    const listing = {
      ...normalized,
      id: 'listing-id',
      firstSeenAt: normalized.scrapedAt,
      lastSeenAt: normalized.scrapedAt,
      previousMaterialHash: null,
      previousPricePln: null,
      isNew: true,
      materiallyChanged: false,
    };
    const fallback = createFallbackAnalysis(listing, {
      totalScore: 78,
      rejected: false,
      reasons: ['RWD jest zgodne z preferencjami.'],
      breakdown: {
        profileFit: 25,
        bodyStyleBonus: 5,
        variant: 10,
        year: 10,
        price: 15,
        engine: 6,
        transmission: 3,
        drivetrain: 5,
        seller: 0,
        dataQuality: 9,
        freshness: 0,
      },
    });

    expect(fallback.totalScore).toBe(78);
    expect(fallback.analysisConfidence).toBe(0);
    expect(fallback.recommendedAction).toBe('call');
  });
});
