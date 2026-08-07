import { describe, expect, it } from 'vitest';
import { buildDeduplicationKey, canonicalUrl } from '../src/services/normalization.js';

describe('deduplication', () => {
  it('uses VIN across marketplaces when available', () => {
    expect(buildDeduplicationKey('olx', 'one', 'WBAVT71090A123456', 'https://olx.pl/x')).toBe(
      'vin:WBAVT71090A123456',
    );
    expect(
      buildDeduplicationKey('otomoto', 'two', 'WBAVT71090A123456', 'https://otomoto.pl/y'),
    ).toBe('vin:WBAVT71090A123456');
  });

  it('uses source ID and canonicalizes tracking URLs', () => {
    expect(buildDeduplicationKey('olx', 'abc', null, 'https://olx.pl/x')).toBe('olx:abc');
    expect(canonicalUrl('https://example.com/car?utm_source=x&id=1#photos')).toBe(
      'https://example.com/car?id=1',
    );
  });
});
