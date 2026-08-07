import type {
  DeterministicScore,
  Listing,
  ListingAnalysis,
  SearchProfile,
} from '../domain/types.js';

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  analyze(
    listing: Listing,
    profile: SearchProfile,
    deterministicScore: DeterministicScore,
  ): Promise<ListingAnalysis>;
}
