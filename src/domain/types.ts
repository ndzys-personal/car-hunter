export type SourceName = 'otomoto' | 'olx' | 'allegro';
export type FuelType = 'petrol' | 'diesel' | 'lpg' | 'hybrid' | 'electric' | 'unknown';
export type Gearbox = 'manual' | 'automatic' | 'unknown';
export type DriveType = 'rwd' | 'awd' | 'fwd' | 'unknown';
export type SellerType = 'private' | 'dealer' | 'uncertain';
export type RecommendedAction = 'ignore' | 'review' | 'call' | 'inspect';

export interface SearchSourceConfig {
  enabled: boolean;
  searchUrl: string;
}

export interface SearchProfile {
  id: string;
  make: 'BMW';
  generation: 'E91' | 'E61';
  acceptedGenerations: Array<'E90' | 'E91' | 'E61'>;
  bodyTypes: Array<'Touring' | 'Sedan'>;
  variants: string[];
  year: { min: number; max: number };
  pricePln: { idealMax: number; hardMax: number };
  preferredEngines: string[];
  sources: Record<SourceName, SearchSourceConfig>;
}

export interface RawListing {
  source: SourceName;
  externalId: string;
  url: string;
  title: string;
  description?: string;
  priceText?: string;
  location?: string;
  sellerName?: string;
  declaredSellerType?: SellerType;
  primaryImageUrl?: string;
  attributes: Record<string, string>;
  scrapedAt: string;
}

export interface MarketplaceFetchResult {
  listings: RawListing[];
  errors: number;
}

export interface Listing {
  source: SourceName;
  sourceListingId: string;
  profileId: string;
  url: string;
  title: string;
  description: string;
  pricePln: number | null;
  year: number | null;
  mileageKm: number | null;
  make: string;
  model: string;
  generation: string | null;
  variant: string | null;
  bodyType: string | null;
  fuelType: FuelType;
  engineCapacityCc: number | null;
  powerHp: number | null;
  gearbox: Gearbox;
  driveType: DriveType;
  vin: string | null;
  location: string | null;
  sellerName: string | null;
  declaredSellerType: SellerType;
  primaryImageUrl: string | null;
  rawAttributes: Record<string, string>;
  materialHash: string;
  deduplicationKey: string;
  scrapedAt: string;
}

export interface ScoreBreakdown {
  profileFit: number;
  variant: number;
  year: number;
  price: number;
  engine: number;
  transmission: number;
  seller: number;
  dataQuality: number;
}

export interface DeterministicScore {
  totalScore: number;
  rejected: boolean;
  reasons: string[];
  breakdown: ScoreBreakdown;
}

export interface ListingAnalysis {
  sellerType: SellerType;
  sellerConfidence: number;
  likelyEngine: string;
  engineConfidence: number;
  fitScore: number;
  riskScore: number;
  totalScore: number;
  priceAssessment: string;
  positives: string[];
  redFlags: string[];
  questionsForSeller: string[];
  summary: string;
  verdict: string;
  recommendedAction: RecommendedAction;
}

export interface PersistedListing extends Listing {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
  previousMaterialHash: string | null;
  previousPricePln: number | null;
  isNew: boolean;
  materiallyChanged: boolean;
}
