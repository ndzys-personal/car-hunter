export type SourceName = 'otomoto' | 'olx' | 'allegro';
export type FuelType = 'petrol' | 'diesel' | 'lpg' | 'hybrid' | 'electric' | 'unknown';
export type Gearbox = 'manual' | 'automatic' | 'unknown';
export type DriveType = 'rwd' | 'awd' | 'fwd' | 'unknown';
export type SellerType = 'private' | 'dealer' | 'uncertain';
export type SellerInferredType =
  'private' | 'likely_private' | 'uncertain' | 'likely_dealer' | 'dealer';
export type RecommendedAction = 'ignore' | 'review' | 'call' | 'inspect';
export type EngineCode = 'N52B25' | 'N52B30' | 'N52B30_or_N53B30' | 'M57' | 'unknown';

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
  preferences: {
    preferredDrive: 'rwd';
    rwdBonus: number;
    awdPenalty: number;
    touringPracticalityBonus: number;
    neutralFeatures: string[];
    freshness: {
      windowHours: number;
      within24HoursBonus: number;
      within72HoursBonus: number;
    };
    seller: {
      privateBonus: number;
      likelyPrivateBonus: number;
      likelyDealerPenalty: number;
      dealerPenalty: number;
    };
  };
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
  sourceSellerId?: string;
  sellerProfileUrl?: string;
  declaredSellerType?: SellerType;
  currentActiveVehicleCount?: number;
  otherVehicleMakes?: string[];
  otherVehicleIds?: string[];
  sellerAccountAgeText?: string;
  sellerCompanyName?: string;
  sellerBusinessSignals?: string[];
  primaryImageUrl?: string;
  publishedAt: string | null;
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
  sourceSellerId: string | null;
  sellerProfileUrl: string | null;
  declaredSellerType: SellerType;
  currentActiveVehicleCount: number | null;
  otherVehicleMakes: string[];
  otherVehicleIds: string[];
  sellerAccountAgeText: string | null;
  sellerCompanyName: string | null;
  sellerBusinessSignals: string[];
  sellerHistory: SellerHistory;
  primaryImageUrl: string | null;
  publishedAt: string | null;
  rawAttributes: Record<string, string>;
  materialHash: string;
  deduplicationKey: string;
  scrapedAt: string;
}

export interface ScoreBreakdown {
  profileFit: number;
  bodyStyleBonus: number;
  variant: number;
  year: number;
  price: number;
  engine: number;
  transmission: number;
  drivetrain: number;
  seller: number;
  dataQuality: number;
  freshness: number;
}

export interface DeterministicScore {
  totalScore: number;
  rejected: boolean;
  reasons: string[];
  breakdown: ScoreBreakdown;
}

export interface ListingAnalysis {
  sellerDeclaredType: SellerType;
  sellerInferredType: SellerInferredType;
  sellerConfidence: number;
  sellerSignals: string[];
  sellerRiskExplanation: string;
  likelyEngine: EngineCode;
  engineConfidence: number;
  analysisConfidence: number;
  majorUncertainties: string[];
  fitScore: number;
  riskScore: number;
  totalScore: number;
  priceAssessment: string;
  positives: string[];
  redFlags: string[];
  questionsForSeller: string[];
  verificationItems: string[];
  summary: string;
  verdict: string;
  recommendedAction: RecommendedAction;
}

export interface SellerHistory {
  currentActiveVehicleCount: number | null;
  historicalVehicleCount: number;
  uniqueMakesCount: number;
  firstSeenSellerAt: string | null;
  lastSeenSellerAt: string | null;
}

export interface SellerAssessment {
  inferredType: SellerInferredType;
  /** Dealer probability, from 0 to 1. */
  confidence: number;
  signals: string[];
  riskExplanation: string;
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
