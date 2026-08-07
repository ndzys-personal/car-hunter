import { describe, expect, it } from 'vitest';
import { searchProfiles } from '../src/config/searches.js';
import { normalizeListing } from '../src/services/normalization.js';
import { rawListing } from './fixtures.js';

describe('normalizeListing', () => {
  it('normalizes Polish marketplace fields and strips tracking parameters', () => {
    const listing = normalizeListing(rawListing(), searchProfiles[0]!);
    expect(listing).toMatchObject({
      pricePln: 21_900,
      year: 2006,
      mileageKm: 267_000,
      variant: '325i',
      generation: 'E91',
      fuelType: 'petrol',
      engineCapacityCc: 2497,
      powerHp: 218,
      gearbox: 'automatic',
      driveType: 'rwd',
      vin: 'WBAVT71090A123456',
    });
    expect(listing.url).not.toContain('utm_source');
  });

  it('changes material hash when price changes', () => {
    const first = normalizeListing(rawListing(), searchProfiles[0]!);
    const second = normalizeListing(rawListing({ priceText: '19 900 PLN' }), searchProfiles[0]!);
    expect(first.materialHash).not.toBe(second.materialHash);
  });

  it('handles Polish decimal prices and kW power without inflating values', () => {
    const listing = normalizeListing(
      rawListing({
        priceText: '21 900,00 PLN',
        attributes: { ...rawListing().attributes, Moc: '160 kW (218 KM)' },
      }),
      searchProfiles[0]!,
    );
    expect(listing.pricePln).toBe(21_900);
    expect(listing.powerHp).toBe(218);
  });

  it('infers the target generation only when model, body and safe production year agree', () => {
    const profile = searchProfiles[0]!;
    const safe = normalizeListing(
      rawListing({ title: 'BMW 325i Touring', attributes: { 'Rok produkcji': '2006' } }),
      profile,
    );
    const ambiguous = normalizeListing(
      rawListing({ title: 'BMW 320i Touring', attributes: { 'Rok produkcji': '2012' } }),
      profile,
    );
    expect(safe.generation).toBe('E91');
    expect(ambiguous.generation).toBeNull();
  });

  it('infers E90 for a matching sedan in the E9x search profile', () => {
    const listing = normalizeListing(
      rawListing({
        title: 'BMW 325i Sedan',
        attributes: { 'Rok produkcji': '2007', Nadwozie: 'Sedan' },
      }),
      searchProfiles[0]!,
    );
    expect(listing.generation).toBe('E90');
    expect(listing.bodyType).toBe('Sedan');
  });

  it('recovers Otomoto price and abbreviated mileage from marketplace text', () => {
    const listing = normalizeListing(
      rawListing({
        title: 'Używany BMW Seria 3 2008 - 18 900 PLN, 260 000 km - Otomoto.pl',
        priceText: '0',
        attributes: {
          'Rok produkcji': '2008',
          Przebieg: '260 tys. km',
          'Rodzaj paliwa': 'Benzyna',
          'Pojemność skokowa': '2 996 cm3',
          Moc: '218 KM',
          'Typ nadwozia': 'Sedan/Limuzyna',
        },
        url: 'https://www.otomoto.pl/osobowe/oferta/bmw-IDABC123.html?search_reason=organic',
      }),
      searchProfiles[0]!,
    );

    expect(listing).toMatchObject({
      pricePln: 18_900,
      mileageKm: 260_000,
      variant: '325i',
      bodyType: 'Sedan',
    });
    expect(listing.url).not.toContain('search_reason');
  });

  it('does not relabel an explicitly declared unsupported variant', () => {
    const listing = normalizeListing(
      rawListing({
        title: 'BMW E91 328xi automat',
        attributes: {
          ...rawListing().attributes,
          'Pojemność skokowa': '2 996 cm3',
          Moc: '250 KM',
        },
      }),
      searchProfiles[0]!,
    );
    expect(listing.variant).toBeNull();
  });
});
