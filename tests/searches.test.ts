import { describe, expect, it } from 'vitest';
import { searchScopeFingerprint } from '../src/config/searches.js';

describe('searchScopeFingerprint', () => {
  it('changes when a marketplace filter changes', () => {
    const touring = 'https://www.olx.pl/search?search%5Bfilter_enum_car_body%5D%5B0%5D=estate-car';
    const touringAndSedan = `${touring}&search%5Bfilter_enum_car_body%5D%5B1%5D=sedan`;

    expect(searchScopeFingerprint('bmw-e61', 'olx', touring)).not.toBe(
      searchScopeFingerprint('bmw-e61', 'olx', touringAndSedan),
    );
  });

  it('is stable for the same trimmed URL', () => {
    expect(searchScopeFingerprint('bmw-e61', 'olx', ' https://example.com/search ')).toBe(
      searchScopeFingerprint('bmw-e61', 'olx', 'https://example.com/search'),
    );
  });
});
