import type { RawListing } from '../src/domain/types.js';

export function rawListing(overrides: Partial<RawListing> = {}): RawListing {
  return {
    source: 'otomoto',
    externalId: 'ABC123',
    url: 'https://www.otomoto.pl/osobowe/oferta/bmw-IDABC123.html?utm_source=test',
    title: 'BMW Seria 3 E91 325i Touring Automat',
    description:
      'Samochód prywatny. Silnik N52B25. VIN WBAVT71090A123456. Faktury z serwisu, olej w skrzyni wymieniony.',
    priceText: '21 900 PLN',
    location: 'Wrocław',
    declaredSellerType: 'private',
    attributes: {
      'Rok produkcji': '2006',
      Przebieg: '267 000 km',
      'Rodzaj paliwa': 'Benzyna',
      'Pojemność skokowa': '2 497 cm3',
      Moc: '218 KM',
      'Skrzynia biegów': 'Automatyczna',
      Nadwozie: 'Kombi',
      Napęd: 'Na tylne koła',
      VIN: 'WBAVT71090A123456',
    },
    scrapedAt: '2026-08-07T08:00:00.000Z',
    ...overrides,
  };
}
