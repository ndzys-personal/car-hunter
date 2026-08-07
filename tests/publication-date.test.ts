import { describe, expect, it } from 'vitest';
import {
  formatPolishRelativeTimestamp,
  parseMarketplacePublishedAt,
} from '../src/services/publication-date.js';

describe('marketplace publication dates', () => {
  const observedAt = '2026-08-07T13:00:00.000Z'; // 15:00 in Warsaw

  it('parses relative Polish labels in the Warsaw timezone', () => {
    expect(parseMarketplacePublishedAt('dzisiaj, 14:32', observedAt)).toBe(
      '2026-08-07T12:32:00.000Z',
    );
    expect(parseMarketplacePublishedAt('wczoraj, 18:10', observedAt)).toBe(
      '2026-08-06T16:10:00.000Z',
    );
    expect(parseMarketplacePublishedAt('dzisiaj', observedAt)).toBe('2026-08-06T22:00:00.000Z');
    expect(parseMarketplacePublishedAt('wczoraj', observedAt)).toBe('2026-08-05T22:00:00.000Z');
  });

  it('parses explicit Polish dates and rejects missing or uncertain values', () => {
    expect(parseMarketplacePublishedAt('7 sierpnia 2026, 14:32', observedAt)).toBe(
      '2026-08-07T12:32:00.000Z',
    );
    expect(parseMarketplacePublishedAt('07.08.2026 14:32', observedAt)).toBe(
      '2026-08-07T12:32:00.000Z',
    );
    expect(parseMarketplacePublishedAt('odświeżono niedawno', observedAt)).toBeNull();
    expect(parseMarketplacePublishedAt(null, observedAt)).toBeNull();
  });

  it('formats publication age compactly in Polish', () => {
    const now = new Date(observedAt);
    expect(formatPolishRelativeTimestamp('2026-08-07T12:32:00.000Z', now)).toBe('dzisiaj, 14:32');
    expect(formatPolishRelativeTimestamp('2026-08-05T12:32:00.000Z', now)).toBe('2 dni temu');
  });
});
