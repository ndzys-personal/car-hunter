import type {
  DeterministicScore,
  Listing,
  ListingAnalysis,
  PersistedListing,
  RecommendedAction,
} from '../domain/types.js';
import type { DatabaseClient } from './client.js';
import { sha256 } from '../services/hash.js';

export class CarHunterRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getListingById(id: string): Promise<PersistedListing | null> {
    const { data, error } = (await this.db
      .from('listings')
      .select('*')
      .eq('id', id)
      .maybeSingle()) as unknown as {
      data: Record<string, unknown> | null;
      error: Error | null;
    };
    if (error) throw error;
    return data ? persistedListingFromRow(data) : null;
  }

  async isBaselineCompleted(requiredScopes: string[]): Promise<boolean> {
    const { data, error } = await this.db
      .from('app_state')
      .select('value')
      .eq('key', 'baseline_completed')
      .maybeSingle();
    if (error) throw error;
    if (data?.value === true) return requiredScopes.length === 0;
    const state = data?.value as { completed?: boolean; scopes?: string[] } | null;
    return (
      state?.completed === true &&
      requiredScopes.every((scope) => (state.scopes ?? []).includes(scope))
    );
  }

  async markBaselineCompleted(scopes: string[]): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.db.from('app_state').upsert({
      key: 'baseline_completed',
      value: { completed: true, baselineVersion: 1, scopes },
      completed_at: now,
      updated_at: now,
    });
    if (error) throw error;
  }

  async startRun(mode: 'baseline' | 'scan', metadata: Record<string, unknown>): Promise<string> {
    const { data, error } = await this.db
      .from('scan_runs')
      .insert({ mode, metadata })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async finishRun(
    id: string,
    status: 'completed' | 'partial' | 'failed',
    counts: { discovered: number; processed: number; errors: number },
  ): Promise<void> {
    const { error } = await this.db
      .from('scan_runs')
      .update({
        status,
        completed_at: new Date().toISOString(),
        discovered_count: counts.discovered,
        processed_count: counts.processed,
        error_count: counts.errors,
      })
      .eq('id', id);
    if (error) throw error;
  }

  async upsertListing(
    listing: Listing,
    score: DeterministicScore,
    scanRunId: string,
  ): Promise<PersistedListing> {
    const { data: existing, error: existingError } = await this.db
      .from('listings')
      .select('id, material_hash, price_pln, first_seen_at, last_seen_at')
      .eq('profile_id', listing.profileId)
      .eq('source', listing.source)
      .eq('source_listing_id', listing.sourceListingId)
      .maybeSingle();
    if (existingError) throw existingError;

    const sellerId = await this.upsertSeller(listing);
    const row = { ...listingToRow(listing, score), seller_id: sellerId };
    const { data, error } = await this.db
      .from('listings')
      .upsert(row, { onConflict: 'profile_id,source,source_listing_id' })
      .select('id, first_seen_at, last_seen_at')
      .single();
    if (error) throw error;

    const isNew = !existing;
    const materiallyChanged = Boolean(existing && existing.material_hash !== listing.materialHash);
    if (isNew || materiallyChanged) {
      const { error: snapshotError } = await this.db.from('listing_snapshots').upsert(
        {
          listing_id: data.id,
          scan_run_id: scanRunId,
          material_hash: listing.materialHash,
          price_pln: listing.pricePln,
          description: listing.description,
          raw_attributes: listing.rawAttributes,
        },
        { onConflict: 'listing_id,material_hash', ignoreDuplicates: true },
      );
      if (snapshotError) throw snapshotError;
    }

    return {
      ...listing,
      id: data.id as string,
      firstSeenAt: data.first_seen_at as string,
      lastSeenAt: data.last_seen_at as string,
      previousMaterialHash: (existing?.material_hash as string | undefined) ?? null,
      previousPricePln: (existing?.price_pln as number | undefined) ?? null,
      isNew,
      materiallyChanged,
    };
  }

  async getCachedAnalysis(
    listingId: string,
    materialHash: string,
    promptVersion: string,
  ): Promise<ListingAnalysis | null> {
    const { data, error } = (await this.db
      .from('listing_analysis')
      .select('*')
      .eq('listing_id', listingId)
      .eq('material_hash', materialHash)
      .eq('prompt_version', promptVersion)
      .maybeSingle()) as unknown as {
      data: Record<string, unknown> | null;
      error: Error | null;
    };
    if (error) throw error;
    return data ? analysisFromRow(data) : null;
  }

  async hasAnalysisForMaterial(listingId: string, materialHash: string): Promise<boolean> {
    const { count, error } = await this.db
      .from('listing_analysis')
      .select('id', { count: 'exact', head: true })
      .eq('listing_id', listingId)
      .eq('material_hash', materialHash);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async saveAnalysis(
    listingId: string,
    materialHash: string,
    provider: string,
    model: string,
    promptVersion: string,
    analysis: ListingAnalysis,
  ): Promise<string> {
    const { data, error } = await this.db
      .from('listing_analysis')
      .upsert(
        {
          listing_id: listingId,
          material_hash: materialHash,
          provider,
          model,
          prompt_version: promptVersion,
          seller_type: analysis.sellerInferredType,
          seller_declared_type: analysis.sellerDeclaredType,
          seller_inferred_type: analysis.sellerInferredType,
          seller_confidence: analysis.sellerConfidence,
          seller_signals: analysis.sellerSignals,
          likely_engine: analysis.likelyEngine,
          engine_confidence: analysis.engineConfidence,
          analysis_confidence: analysis.analysisConfidence,
          major_uncertainties: analysis.majorUncertainties,
          fit_score: analysis.fitScore,
          risk_score: analysis.riskScore,
          total_score: analysis.totalScore,
          price_assessment: analysis.priceAssessment,
          positives: analysis.positives,
          red_flags: analysis.redFlags,
          questions_for_seller: analysis.questionsForSeller,
          verification_items: analysis.verificationItems,
          summary: analysis.summary,
          verdict: analysis.verdict,
          recommended_action: analysis.recommendedAction,
          raw_response: analysis,
        },
        { onConflict: 'listing_id,material_hash,prompt_version' },
      )
      .select('id')
      .single();
    if (error) throw error;
    const { data: listingRow, error: listingError } = await this.db
      .from('listings')
      .select('seller_id')
      .eq('id', listingId)
      .maybeSingle();
    if (listingError) throw listingError;
    if (listingRow?.seller_id) {
      const { error: sellerError } = await this.db
        .from('sellers')
        .update({
          likely_type: analysis.sellerInferredType,
          confidence: analysis.sellerConfidence,
          signals: analysis.sellerSignals,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', listingRow.seller_id);
      if (sellerError) throw sellerError;
    }
    return data.id as string;
  }

  private async upsertSeller(listing: Listing): Promise<string | null> {
    if (!listing.sellerName) return null;
    const normalizedName = listing.sellerName.toLocaleLowerCase('pl').replace(/\s+/g, ' ').trim();
    const sourceSellerId =
      listing.declaredSellerType === 'dealer'
        ? `name:${sha256(normalizedName).slice(0, 24)}`
        : `listing:${listing.sourceListingId}`;
    const { data, error } = await this.db
      .from('sellers')
      .upsert(
        {
          source: listing.source,
          source_seller_id: sourceSellerId,
          name: listing.sellerName,
          declared_type: listing.declaredSellerType,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'source,source_seller_id' },
      )
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async wasNotified(listingId: string, materialHash: string): Promise<boolean> {
    const { count, error } = await this.db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('listing_id', listingId)
      .eq('material_hash', materialHash);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async saveNotification(input: {
    listingId: string;
    analysisId: string;
    materialHash: string;
    reason: string;
    totalScore: number;
    recommendedAction: RecommendedAction;
    telegramMessageId: string;
  }): Promise<void> {
    const { error } = await this.db.from('notifications').insert({
      listing_id: input.listingId,
      listing_analysis_id: input.analysisId,
      material_hash: input.materialHash,
      reason: input.reason,
      total_score: input.totalScore,
      recommended_action: input.recommendedAction,
      telegram_message_id: input.telegramMessageId,
    });
    if (error) throw error;
  }
}

function listingToRow(listing: Listing, score: DeterministicScore) {
  return {
    source: listing.source,
    source_listing_id: listing.sourceListingId,
    profile_id: listing.profileId,
    deduplication_key: listing.deduplicationKey,
    url: listing.url,
    title: listing.title,
    description: listing.description,
    price_pln: listing.pricePln,
    year: listing.year,
    mileage_km: listing.mileageKm,
    make: listing.make,
    model: listing.model,
    generation: listing.generation,
    variant: listing.variant,
    body_type: listing.bodyType,
    fuel_type: listing.fuelType,
    engine_capacity_cc: listing.engineCapacityCc,
    power_hp: listing.powerHp,
    gearbox: listing.gearbox,
    drive_type: listing.driveType,
    vin: listing.vin,
    location: listing.location,
    seller_name: listing.sellerName,
    declared_seller_type: listing.declaredSellerType,
    primary_image_url: listing.primaryImageUrl,
    raw_attributes: listing.rawAttributes,
    material_hash: listing.materialHash,
    deterministic_score: score.totalScore,
    deterministic_breakdown: score.breakdown,
    deterministic_rejected: score.rejected,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function analysisFromRow(row: Record<string, unknown>): ListingAnalysis {
  return {
    sellerDeclaredType: (row.seller_declared_type ??
      'uncertain') as ListingAnalysis['sellerDeclaredType'],
    sellerInferredType: (row.seller_inferred_type ??
      row.seller_type) as ListingAnalysis['sellerInferredType'],
    sellerConfidence: Number(row.seller_confidence),
    sellerSignals: (row.seller_signals ?? []) as string[],
    likelyEngine: String(row.likely_engine) as ListingAnalysis['likelyEngine'],
    engineConfidence: Number(row.engine_confidence),
    analysisConfidence: Number(row.analysis_confidence ?? 0.5),
    majorUncertainties: (row.major_uncertainties ?? []) as string[],
    fitScore: Number(row.fit_score),
    riskScore: Number(row.risk_score),
    totalScore: Number(row.total_score),
    priceAssessment: String(row.price_assessment),
    positives: row.positives as string[],
    redFlags: row.red_flags as string[],
    questionsForSeller: row.questions_for_seller as string[],
    verificationItems: (row.verification_items ?? row.questions_for_seller ?? []) as string[],
    summary: String(row.summary),
    verdict: String(row.verdict),
    recommendedAction: row.recommended_action as ListingAnalysis['recommendedAction'],
  };
}

function persistedListingFromRow(row: Record<string, unknown>): PersistedListing {
  return {
    id: String(row.id),
    source: row.source as PersistedListing['source'],
    sourceListingId: String(row.source_listing_id),
    profileId: String(row.profile_id),
    deduplicationKey: String(row.deduplication_key),
    url: String(row.url),
    title: String(row.title),
    description: typeof row.description === 'string' ? row.description : '',
    pricePln: nullableNumber(row.price_pln),
    year: nullableNumber(row.year),
    mileageKm: nullableNumber(row.mileage_km),
    make: String(row.make),
    model: String(row.model),
    generation: nullableString(row.generation),
    variant: nullableString(row.variant),
    bodyType: nullableString(row.body_type),
    fuelType: row.fuel_type as PersistedListing['fuelType'],
    engineCapacityCc: nullableNumber(row.engine_capacity_cc),
    powerHp: nullableNumber(row.power_hp),
    gearbox: row.gearbox as PersistedListing['gearbox'],
    driveType: row.drive_type as PersistedListing['driveType'],
    vin: nullableString(row.vin),
    location: nullableString(row.location),
    sellerName: nullableString(row.seller_name),
    declaredSellerType: row.declared_seller_type as PersistedListing['declaredSellerType'],
    primaryImageUrl: nullableString(row.primary_image_url),
    rawAttributes: (row.raw_attributes ?? {}) as Record<string, string>,
    materialHash: String(row.material_hash),
    scrapedAt: String(row.last_seen_at),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    previousMaterialHash: null,
    previousPricePln: null,
    isNew: false,
    materiallyChanged: false,
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return null;
}
