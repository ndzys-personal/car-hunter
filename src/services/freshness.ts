import type { Listing, SearchProfile } from '../domain/types.js';

export function isFreshListing(
  listing: Pick<Listing, 'publishedAt' | 'scrapedAt'>,
  windowHours: number,
): boolean {
  const age = publicationAgeHours(listing.publishedAt, listing.scrapedAt);
  return age !== null && age <= windowHours;
}

export function scoreFreshness(
  listing: Pick<Listing, 'publishedAt' | 'scrapedAt'>,
  profile: SearchProfile,
): number {
  const age = publicationAgeHours(listing.publishedAt, listing.scrapedAt);
  if (age === null || age > profile.preferences.freshness.windowHours) return 0;
  if (age <= 24) return profile.preferences.freshness.within24HoursBonus;
  if (age <= 72) return profile.preferences.freshness.within72HoursBonus;
  return 0;
}

export function publicationAgeHours(publishedAt: string | null, observedAt: string): number | null {
  if (!publishedAt) return null;
  const published = new Date(publishedAt).getTime();
  const observed = new Date(observedAt).getTime();
  if (!Number.isFinite(published) || !Number.isFinite(observed) || published > observed)
    return null;
  return (observed - published) / 3_600_000;
}
