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
  acceptedGenerations: Array<'E60' | 'E61' | 'E90' | 'E91'>;
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

export type HistoryConfidence = 'low' | 'medium' | 'high';
export type HistorySignalSeverity = 'info' | 'warning' | 'strong_warning' | 'positive';
export type VehicleHistorySignalType =
  | 'vehicle_listed_for_months'
  | 'multiple_price_reductions'
  | 'mileage_decrease'
  | 'mileage_increase_normal'
  | 'unusually_high_usage'
  | 'stale_mileage_description'
  | 'major_description_change'
  | 'previously_damaged'
  | 'previously_non_running'
  | 'seller_changed'
  | 'possible_flip'
  | 'seller_consistency';

/** A dated observation. Facts are nullable rather than inferred from a similar-looking car. */
export interface HistoricalVehicleRecord {
  id?: string;
  source: string;
  sourceListingId?: string | null;
  historicalUrl: string;
  observedAt: string;
  publishedAt: string | null;
  pricePln: number | null;
  mileageKm: number | null;
  title: string | null;
  vehicleModel: string | null;
  location: string | null;
  sellerId: string | null;
  sellerName: string | null;
  sellerType: SellerType | null;
  descriptionExcerpt: string | null;
  damageStatus: 'damaged' | 'not_damaged' | 'unknown';
  runningStatus: 'running' | 'non_running' | 'unknown';
  vinConfirmed: boolean;
  confidence: HistoryConfidence;
  evidenceUrl: string;
  origin: 'internal' | 'external';
}

export interface VehicleHistorySignal {
  type: VehicleHistorySignalType;
  severity: HistorySignalSeverity;
  confidence: HistoryConfidence;
  messagePl: string;
  evidenceUrls: string[];
}

export interface VehicleHistoryAnalysis {
  vin: string | null;
  earliestKnownListing: string | null;
  listedSinceAt: string | null;
  estimatedDaysOnMarket: number | null;
  previousListings: HistoricalVehicleRecord[];
  currentPrice: number | null;
  previousPrices: number[];
  priceDropAmount: number | null;
  priceDropPercent: number | null;
  historySignals: VehicleHistorySignal[];
  scoreAdjustment: number;
  meaningful: boolean;
  serious: boolean;
  checkedAt: string | null;
  fingerprint: string;
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
  vehicleId?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  previousMaterialHash: string | null;
  previousPricePln: number | null;
  isNew: boolean;
  materiallyChanged: boolean;
}
