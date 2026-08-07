import { describe, expect, it } from 'vitest';
import { resolveListingTimestamps } from '../src/db/repository.js';

describe('listing observation timestamps', () => {
  it('sets firstSeenAt and lastSeenAt on initial discovery', () => {
    expect(resolveListingTimestamps(null, '2026-08-07T10:00:00Z', '2026-08-07T09:00:00Z')).toEqual({
      publishedAt: '2026-08-07T09:00:00.000Z',
      firstSeenAt: '2026-08-07T10:00:00.000Z',
      lastSeenAt: '2026-08-07T10:00:00.000Z',
    });
  });

  it('preserves firstSeenAt and advances lastSeenAt on later observations', () => {
    const existing = {
      publishedAt: '2026-08-07T09:00:00.000Z',
      firstSeenAt: '2026-08-07T10:00:00.000Z',
      lastSeenAt: '2026-08-07T10:00:00.000Z',
    };
    const later = resolveListingTimestamps(
      existing,
      '2026-08-07T12:00:00Z',
      '2026-08-07T11:00:00Z',
    );
    expect(later.firstSeenAt).toBe(existing.firstSeenAt);
    expect(later.lastSeenAt).toBe('2026-08-07T12:00:00.000Z');
    expect(later.publishedAt).toBe(existing.publishedAt);
  });

  it('preserves the earliest reliable publication timestamp', () => {
    const existing = {
      publishedAt: '2026-08-07T09:00:00.000Z',
      firstSeenAt: '2026-08-07T10:00:00.000Z',
      lastSeenAt: '2026-08-07T10:00:00.000Z',
    };
    expect(
      resolveListingTimestamps(existing, '2026-08-07T12:00:00Z', '2026-08-07T08:30:00Z')
        .publishedAt,
    ).toBe('2026-08-07T08:30:00.000Z');
  });

  it('rejects a publication timestamp later than the observation', () => {
    expect(
      resolveListingTimestamps(null, '2026-08-07T10:00:00Z', '2026-08-07T10:30:00Z').publishedAt,
    ).toBeNull();
  });
});
