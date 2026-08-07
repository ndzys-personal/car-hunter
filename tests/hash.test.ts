import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/services/hash.js';

describe('sha256', () => {
  it('is stable when object key order changes', () => {
    expect(sha256({ price: 10, attributes: { b: 2, a: 1 } })).toBe(
      sha256({ attributes: { a: 1, b: 2 }, price: 10 }),
    );
  });
});
