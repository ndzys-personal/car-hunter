import 'dotenv/config';
import type { SearchProfile, SourceName } from '../domain/types.js';

function source(name: SourceName, generation: 'E91' | 'E61') {
  const key = `${name.toUpperCase()}_${generation}_URL`;
  const searchUrl = process.env[key]?.trim() ?? '';
  return { enabled: searchUrl.length > 0, searchUrl };
}

export const searchProfiles: SearchProfile[] = [
  {
    id: 'bmw-e91',
    make: 'BMW',
    generation: 'E91',
    acceptedGenerations: ['E90', 'E91'],
    bodyTypes: ['Touring', 'Sedan'],
    variants: ['320i', '325i', '330i', '320d', '325d', '330d'],
    year: { min: 2005, max: 2012 },
    pricePln: { idealMax: 35_000, hardMax: 45_000 },
    preferredEngines: ['N52B25', 'N52B30', 'M57'],
    preferences: {
      preferredDrive: 'rwd',
      rwdBonus: 5,
      awdPenalty: 8,
      touringPracticalityBonus: 5,
      neutralFeatures: ['M-pakiet'],
      freshness: {
        windowHours: 72,
        within24HoursBonus: 4,
        within72HoursBonus: 2,
      },
      seller: {
        privateBonus: 6,
        likelyPrivateBonus: 6,
        likelyDealerPenalty: 6,
        dealerPenalty: 10,
      },
    },
    sources: {
      otomoto: source('otomoto', 'E91'),
      olx: source('olx', 'E91'),
      allegro: source('allegro', 'E91'),
    },
  },
  {
    id: 'bmw-e61',
    make: 'BMW',
    generation: 'E61',
    acceptedGenerations: ['E61'],
    bodyTypes: ['Touring'],
    variants: ['525i', '530i', '525d', '530d'],
    year: { min: 2004, max: 2010 },
    pricePln: { idealMax: 40_000, hardMax: 50_000 },
    preferredEngines: ['N52B25', 'N52B30', 'M57'],
    preferences: {
      preferredDrive: 'rwd',
      rwdBonus: 5,
      awdPenalty: 8,
      touringPracticalityBonus: 5,
      neutralFeatures: ['M-pakiet'],
      freshness: {
        windowHours: 72,
        within24HoursBonus: 4,
        within72HoursBonus: 2,
      },
      seller: {
        privateBonus: 6,
        likelyPrivateBonus: 6,
        likelyDealerPenalty: 6,
        dealerPenalty: 10,
      },
    },
    sources: {
      otomoto: source('otomoto', 'E61'),
      olx: source('olx', 'E61'),
      allegro: source('allegro', 'E61'),
    },
  },
];

export function enabledSearchScopes(): string[] {
  return searchProfiles.flatMap((profile) =>
    (Object.keys(profile.sources) as SourceName[])
      .filter((name) => profile.sources[name].enabled)
      .map((name) => `${profile.id}:${name}`),
  );
}
