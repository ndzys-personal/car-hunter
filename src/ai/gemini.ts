import { GoogleGenAI } from '@google/genai';
import type {
  DeterministicScore,
  Listing,
  ListingAnalysis,
  SearchProfile,
  VehicleHistoryAnalysis,
} from '../domain/types.js';
import type { AiProvider } from './provider.js';
import { LISTING_ANALYSIS_SYSTEM_PROMPT } from './prompts/listing-analysis.js';
import { applyRecommendationPolicy } from './recommendation-policy.js';
import { rawListingAnalysisJsonSchema, rawListingAnalysisSchema } from './schema.js';

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async analyze(
    listing: Listing,
    profile: SearchProfile,
    deterministicScore: DeterministicScore,
    vehicleHistory?: VehicleHistoryAnalysis,
  ): Promise<ListingAnalysis> {
    const contents = buildListingAnalysisContents(
      listing,
      profile,
      deterministicScore,
      vehicleHistory,
    );
    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config: {
        httpOptions: {
          timeout: 30_000,
          retryOptions: { attempts: 2 },
        },
        responseMimeType: 'application/json',
        responseJsonSchema: rawListingAnalysisJsonSchema,
      },
    });
    if (!response.text) throw new Error('Gemini returned an empty response');
    const raw = rawListingAnalysisSchema.parse(JSON.parse(response.text));
    return applyRecommendationPolicy(raw, listing, profile, deterministicScore, vehicleHistory);
  }
}

export function buildListingAnalysisContents(
  listing: Listing,
  profile: SearchProfile,
  deterministicScore: DeterministicScore,
  vehicleHistory?: VehicleHistoryAnalysis,
): string {
  return `${LISTING_ANALYSIS_SYSTEM_PROMPT}\n\nAnalyze this input:\n${JSON.stringify({
    profile,
    listing,
    deterministicScore,
    vehicleHistory: vehicleHistory ?? null,
  })}`;
}
