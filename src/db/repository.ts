import type {
  DeterministicScore,
  Listing,
  ListingAnalysis,
  HistoricalVehicleRecord,
  PersistedListing,
  RecommendedAction,
  SearchProfile,
  SellerHistory,
  VehicleHistoryAnalysis,
} from '../domain/types.js';
import type { DatabaseClient } from './client.js';
import { sha256 } from '../services/hash.js';
import { scoreListing } from '../services/scoring.js';
import { detectSellerType } from '../services/seller-detection.js';
import { normalizeVin } from '../services/vin.js';

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
    profile: SearchProfile,
    scanRunId: string,
  ): Promise<{ listing: PersistedListing; score: DeterministicScore }> {
    const { data: existing, error: existingError } = await this.db
      .from('listings')
      .select('id, material_hash, price_pln, published_at, first_seen_at, last_seen_at')
      .eq('profile_id', listing.profileId)
      .eq('source', listing.source)
      .eq('source_listing_id', listing.sourceListingId)
      .maybeSingle();
    if (existingError) throw existingError;

    const seller = await this.upsertSeller(listing);
    const vehicleId = await this.upsertVehicle(listing);
    const timestamps = resolveListingTimestamps(
      existing
        ? {
            firstSeenAt: String(existing.first_seen_at),
            lastSeenAt: String(existing.last_seen_at),
            publishedAt: typeof existing.published_at === 'string' ? existing.published_at : null,
          }
        : null,
      listing.scrapedAt,
      listing.publishedAt,
    );
    const effectiveListing = {
      ...listing,
      publishedAt: timestamps.publishedAt,
      sellerHistory: seller?.history ?? listing.sellerHistory,
    };
    const score = scoreListing(effectiveListing, profile);
    const row: Record<string, unknown> = {
      ...listingToRow(effectiveListing, score),
      seller_id: seller?.id ?? null,
      vehicle_id: vehicleId,
      published_at: timestamps.publishedAt,
      last_seen_at: timestamps.lastSeenAt,
    };
    if (!existing) row.first_seen_at = timestamps.firstSeenAt;
    const { data, error } = await this.db
      .from('listings')
      .upsert(row, { onConflict: 'profile_id,source,source_listing_id' })
      .select('id, published_at, first_seen_at, last_seen_at')
      .single();
    if (error) throw error;

    const isNew = !existing;
    const materiallyChanged = Boolean(existing && existing.material_hash !== listing.materialHash);
    {
      const { error: snapshotError } = await this.db.from('listing_snapshots').upsert(
        {
          listing_id: data.id,
          scan_run_id: scanRunId,
          material_hash: listing.materialHash,
          price_pln: listing.pricePln,
          mileage_km: listing.mileageKm,
          vehicle_id: vehicleId,
          source: listing.source,
          source_listing_id: listing.sourceListingId,
          vin: normalizeVin(listing.vin),
          title: listing.title,
          published_at: timestamps.publishedAt,
          first_seen_at: timestamps.firstSeenAt,
          last_seen_at: timestamps.lastSeenAt,
          seller_id: seller?.id ?? null,
          seller_name: listing.sellerName,
          seller_type: listing.declaredSellerType,
          location: listing.location,
          description_hash: sha256(listing.description),
          listing_url: listing.url,
          captured_at: listing.scrapedAt,
          description: listing.description,
          raw_attributes: listing.rawAttributes,
        },
        { onConflict: 'listing_id,captured_at', ignoreDuplicates: true },
      );
      if (snapshotError) throw snapshotError;
    }

    return {
      score,
      listing: {
        ...effectiveListing,
        publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
        id: data.id as string,
        vehicleId,
        firstSeenAt: data.first_seen_at as string,
        lastSeenAt: data.last_seen_at as string,
        previousMaterialHash: (existing?.material_hash as string | undefined) ?? null,
        previousPricePln: (existing?.price_pln as number | undefined) ?? null,
        isNew,
        materiallyChanged,
      },
    };
  }

  private async upsertVehicle(listing: Listing): Promise<string | null> {
    const vin = normalizeVin(listing.vin);
    if (!vin) return null;
    const { data, error } = await this.db
      .from('vehicles')
      .upsert(
        { normalized_vin: vin, last_seen_at: listing.scrapedAt },
        { onConflict: 'normalized_vin' },
      )
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async getHistoryCache(vehicleId: string): Promise<{
    historyCheckedAt: string | null;
    historyCheckVersion: string | null;
    listingFingerprint: string | null;
    sellerFingerprint: string | null;
  }> {
    const { data, error } = await this.db
      .from('vehicles')
      .select(
        'history_checked_at, history_check_version, history_listing_fingerprint, history_seller_fingerprint',
      )
      .eq('id', vehicleId)
      .single();
    if (error) throw error;
    return {
      historyCheckedAt: nullableString(data.history_checked_at),
      historyCheckVersion: nullableString(data.history_check_version),
      listingFingerprint: nullableString(data.history_listing_fingerprint),
      sellerFingerprint: nullableString(data.history_seller_fingerprint),
    };
  }

  async markHistoryChecked(
    vehicleId: string,
    input: {
      checkedAt: string;
      version: string;
      listingFingerprint: string;
      sellerFingerprint: string;
    },
  ): Promise<void> {
    const { error } = await this.db
      .from('vehicles')
      .update({
        history_checked_at: input.checkedAt,
        history_check_version: input.version,
        history_listing_fingerprint: input.listingFingerprint,
        history_seller_fingerprint: input.sellerFingerprint,
      })
      .eq('id', vehicleId);
    if (error) throw error;
  }

  async saveExternalHistory(vehicleId: string, records: HistoricalVehicleRecord[]): Promise<void> {
    if (!records.length) return;
    const rows = records.map((record) => ({
      vehicle_id: vehicleId,
      source: record.source,
      source_listing_id: record.sourceListingId ?? null,
      historical_url: record.historicalUrl,
      observed_at: record.observedAt,
      published_at: record.publishedAt,
      price_pln: record.pricePln,
      mileage_km: record.mileageKm,
      title: record.title,
      vehicle_model: record.vehicleModel,
      location: record.location,
      seller_external_id: record.sellerId,
      seller_name: record.sellerName,
      seller_type: record.sellerType,
      description_excerpt: record.descriptionExcerpt,
      damage_status: record.damageStatus,
      running_status: record.runningStatus,
      vin_confirmed: record.vinConfirmed,
      confidence: record.confidence,
      evidence_url: record.evidenceUrl,
    }));
    const { error } = await this.db.from('historical_listings').upsert(rows, {
      onConflict: 'vehicle_id,historical_url,observed_at',
      ignoreDuplicates: true,
    });
    if (error) throw error;
  }

  async getHistoryRecords(vehicleId: string): Promise<HistoricalVehicleRecord[]> {
    const [snapshotsResult, externalResult] = await Promise.all([
      this.db.from('listing_snapshots').select('*').eq('vehicle_id', vehicleId),
      this.db.from('historical_listings').select('*').eq('vehicle_id', vehicleId),
    ]);
    if (snapshotsResult.error) throw snapshotsResult.error;
    if (externalResult.error) throw externalResult.error;
    const internal = ((snapshotsResult.data ?? []) as Array<Record<string, unknown>>).map(
      snapshotHistoryFromRow,
    );
    const external = ((externalResult.data ?? []) as Array<Record<string, unknown>>).map(
      externalHistoryFromRow,
    );
    return [...internal, ...external];
  }

  async saveHistorySignals(vehicleId: string, analysis: VehicleHistoryAnalysis): Promise<void> {
    const rows = analysis.historySignals.map((item) => ({
      vehicle_id: vehicleId,
      analysis_fingerprint: analysis.fingerprint,
      signal_type: item.type,
      severity: item.severity,
      confidence: item.confidence,
      message_pl: item.messagePl,
      evidence_urls: item.evidenceUrls,
    }));
    if (!rows.length) return;
    const { error } = await this.db.from('vehicle_history_signals').upsert(rows, {
      onConflict: 'vehicle_id,analysis_fingerprint,signal_type',
    });
    if (error) throw error;
  }

  async getCachedAnalysis(
    listingId: string,
    materialHash: string,
    promptVersion: string,
    historyFingerprint = 'none',
  ): Promise<ListingAnalysis | null> {
    const { data, error } = (await this.db
      .from('listing_analysis')
      .select('*')
      .eq('listing_id', listingId)
      .eq('material_hash', materialHash)
      .eq('prompt_version', promptVersion)
      .eq('history_fingerprint', historyFingerprint)
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
    historyFingerprint = 'none',
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
          history_fingerprint: historyFingerprint,
          seller_type: analysis.sellerInferredType,
          seller_declared_type: analysis.sellerDeclaredType,
          seller_inferred_type: analysis.sellerInferredType,
          seller_confidence: analysis.sellerConfidence,
          seller_signals: analysis.sellerSignals,
          seller_risk_explanation: analysis.sellerRiskExplanation,
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
          risk_explanation: analysis.sellerRiskExplanation,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', listingRow.seller_id);
      if (sellerError) throw sellerError;
    }
    return data.id as string;
  }

  private async upsertSeller(
    listing: Listing,
  ): Promise<{ id: string; history: SellerHistory } | null> {
    if (!listing.sellerName && !listing.sourceSellerId) return null;
    const normalizedName = (listing.sellerName ?? '')
      .toLocaleLowerCase('pl')
      .replace(/\s+/g, ' ')
      .trim();
    const sourceSellerId = listing.sourceSellerId
      ? `public:${sha256(listing.sourceSellerId).slice(0, 32)}`
      : listing.declaredSellerType === 'dealer' && normalizedName
        ? `name:${sha256(normalizedName).slice(0, 24)}`
        : `listing:${listing.sourceListingId}`;
    const observedAt = listing.scrapedAt;
    const sellerRow = {
      source: listing.source,
      source_seller_id: sourceSellerId,
      declared_type: listing.declaredSellerType,
      last_seen_at: observedAt,
      ...(listing.sellerName ? { name: listing.sellerName } : {}),
      ...(listing.currentActiveVehicleCount !== null
        ? { current_active_vehicle_count: listing.currentActiveVehicleCount }
        : {}),
      ...(listing.sellerCompanyName ? { company_name: listing.sellerCompanyName } : {}),
      ...(listing.sellerAccountAgeText ? { account_age_text: listing.sellerAccountAgeText } : {}),
      ...(listing.sellerBusinessSignals.length
        ? { business_signals: listing.sellerBusinessSignals }
        : {}),
    };
    const { data, error } = await this.db
      .from('sellers')
      .upsert(sellerRow, { onConflict: 'source,source_seller_id' })
      .select('id')
      .single();
    if (error) throw error;
    const sellerId = data.id as string;
    const { error: historyError } = await this.db.from('seller_listing_history').upsert(
      {
        seller_id: sellerId,
        source_listing_id: listing.sourceListingId,
        make: listing.make,
        model: listing.model,
        last_seen_at: observedAt,
      },
      { onConflict: 'seller_id,source_listing_id' },
    );
    if (historyError) throw historyError;
    const { data: historyRows, error: historyReadError } = await this.db
      .from('seller_listing_history')
      .select('make, first_seen_at, last_seen_at')
      .eq('seller_id', sellerId);
    if (historyReadError) throw historyReadError;
    const rows = (historyRows ?? []) as Array<{
      make: string | null;
      first_seen_at: string;
      last_seen_at: string;
    }>;
    const history: SellerHistory = {
      currentActiveVehicleCount: listing.currentActiveVehicleCount,
      historicalVehicleCount: rows.length,
      uniqueMakesCount: new Set(rows.map((row) => row.make).filter(Boolean)).size,
      firstSeenSellerAt: earliestDate(rows.map((row) => row.first_seen_at)),
      lastSeenSellerAt: latestDate(rows.map((row) => row.last_seen_at)),
    };
    const assessment = detectSellerType({ ...listing, sellerHistory: history });
    const { error: sellerProfileError } = await this.db
      .from('sellers')
      .update({
        likely_type: assessment.inferredType,
        confidence: assessment.confidence,
        signals: assessment.signals,
        risk_explanation: assessment.riskExplanation,
        historical_vehicle_count: history.historicalVehicleCount,
        unique_makes_count: history.uniqueMakesCount,
        last_seen_at: observedAt,
      })
      .eq('id', sellerId);
    if (sellerProfileError) throw sellerProfileError;
    return { id: sellerId, history };
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
    analysisId?: string;
    materialHash: string;
    reason: string;
    totalScore: number;
    recommendedAction: RecommendedAction;
    telegramMessageId: string;
  }): Promise<void> {
    const { error } = await this.db.from('notifications').insert({
      listing_id: input.listingId,
      listing_analysis_id: input.analysisId ?? null,
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
    source_seller_id: listing.sourceSellerId,
    seller_profile_url: listing.sellerProfileUrl,
    declared_seller_type: listing.declaredSellerType,
    seller_marketplace_data: {
      currentActiveVehicleCount: listing.currentActiveVehicleCount,
      otherVehicleMakes: listing.otherVehicleMakes,
      otherVehicleIds: listing.otherVehicleIds,
      accountAgeText: listing.sellerAccountAgeText,
      companyName: listing.sellerCompanyName,
      businessSignals: listing.sellerBusinessSignals,
    },
    seller_history: listing.sellerHistory,
    primary_image_url: listing.primaryImageUrl,
    published_at: listing.publishedAt,
    raw_attributes: listing.rawAttributes,
    material_hash: listing.materialHash,
    deterministic_score: score.totalScore,
    deterministic_breakdown: score.breakdown,
    deterministic_rejected: score.rejected,
    last_seen_at: listing.scrapedAt,
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
    sellerRiskExplanation:
      nullableString(row.seller_risk_explanation) ?? 'Brak wystarczających danych o sprzedającym.',
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
    vehicleId: nullableString(row.vehicle_id),
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
    sourceSellerId: nullableString(row.source_seller_id),
    sellerProfileUrl: nullableString(row.seller_profile_url),
    declaredSellerType: row.declared_seller_type as PersistedListing['declaredSellerType'],
    currentActiveVehicleCount: nullableNumber(
      (row.seller_marketplace_data as Record<string, unknown> | null)?.currentActiveVehicleCount,
    ),
    otherVehicleMakes: stringArray(
      (row.seller_marketplace_data as Record<string, unknown> | null)?.otherVehicleMakes,
    ),
    otherVehicleIds: stringArray(
      (row.seller_marketplace_data as Record<string, unknown> | null)?.otherVehicleIds,
    ),
    sellerAccountAgeText: nullableString(
      (row.seller_marketplace_data as Record<string, unknown> | null)?.accountAgeText,
    ),
    sellerCompanyName: nullableString(
      (row.seller_marketplace_data as Record<string, unknown> | null)?.companyName,
    ),
    sellerBusinessSignals: stringArray(
      (row.seller_marketplace_data as Record<string, unknown> | null)?.businessSignals,
    ),
    sellerHistory: sellerHistoryFromRow(row),
    primaryImageUrl: nullableString(row.primary_image_url),
    publishedAt: nullableString(row.published_at),
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

function snapshotHistoryFromRow(row: Record<string, unknown>): HistoricalVehicleRecord {
  const description = nullableString(row.description);
  return {
    source: String(row.source),
    sourceListingId: nullableString(row.source_listing_id),
    historicalUrl: String(row.listing_url),
    observedAt: String(row.captured_at),
    publishedAt: nullableString(row.published_at),
    pricePln: nullableNumber(row.price_pln),
    mileageKm: nullableNumber(row.mileage_km),
    title: nullableString(row.title),
    vehicleModel: null,
    location: nullableString(row.location),
    sellerId: nullableString(row.seller_id),
    sellerName: nullableString(row.seller_name),
    sellerType: nullableString(row.seller_type) as HistoricalVehicleRecord['sellerType'],
    descriptionExcerpt: description?.slice(0, 800) ?? null,
    damageStatus: /uszkodzon|do naprawy|powypadkow|awaria/i.test(description ?? '')
      ? 'damaged'
      : 'unknown',
    runningStatus: /nie odpala|nie jeździ|niesprawn/i.test(description ?? '')
      ? 'non_running'
      : 'unknown',
    vinConfirmed: Boolean(row.vin),
    confidence: 'high',
    evidenceUrl: String(row.listing_url),
    origin: 'internal',
  };
}

function externalHistoryFromRow(row: Record<string, unknown>): HistoricalVehicleRecord {
  return {
    id: String(row.id),
    source: String(row.source),
    sourceListingId: nullableString(row.source_listing_id),
    historicalUrl: String(row.historical_url),
    observedAt: String(row.observed_at),
    publishedAt: nullableString(row.published_at),
    pricePln: nullableNumber(row.price_pln),
    mileageKm: nullableNumber(row.mileage_km),
    title: nullableString(row.title),
    vehicleModel: nullableString(row.vehicle_model),
    location: nullableString(row.location),
    sellerId: nullableString(row.seller_external_id),
    sellerName: nullableString(row.seller_name),
    sellerType: nullableString(row.seller_type) as HistoricalVehicleRecord['sellerType'],
    descriptionExcerpt: nullableString(row.description_excerpt),
    damageStatus: String(row.damage_status) as HistoricalVehicleRecord['damageStatus'],
    runningStatus: String(row.running_status) as HistoricalVehicleRecord['runningStatus'],
    vinConfirmed: Boolean(row.vin_confirmed),
    confidence: String(row.confidence) as HistoricalVehicleRecord['confidence'],
    evidenceUrl: String(row.evidence_url),
    origin: 'external',
  };
}

export interface ListingTimestamps {
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export function resolveListingTimestamps(
  existing: ListingTimestamps | null,
  observedAt: string,
  candidatePublishedAt: string | null,
): ListingTimestamps {
  const observed = validIso(observedAt);
  if (!observed) throw new Error(`Invalid listing observation timestamp: ${observedAt}`);
  const rawCandidatePublished = validIso(candidatePublishedAt);
  const candidatePublished =
    rawCandidatePublished && new Date(rawCandidatePublished) <= new Date(observed)
      ? rawCandidatePublished
      : null;
  if (!existing) {
    return {
      publishedAt: candidatePublished,
      firstSeenAt: observed,
      lastSeenAt: observed,
    };
  }
  const existingFirstSeen = validIso(existing.firstSeenAt) ?? observed;
  const existingLastSeen = validIso(existing.lastSeenAt) ?? observed;
  const existingPublished = validIso(existing.publishedAt);
  return {
    publishedAt: earliest(existingPublished, candidatePublished),
    firstSeenAt: existingFirstSeen,
    lastSeenAt: latest(existingLastSeen, observed),
  };
}

function validIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function earliest(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return new Date(left) <= new Date(right) ? left : right;
}

function latest(left: string, right: string): string {
  return new Date(left) >= new Date(right) ? left : right;
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function earliestDate(values: string[]): string | null {
  const valid = values.map((value) => validIso(value)).filter((value): value is string => !!value);
  return valid.sort()[0] ?? null;
}

function latestDate(values: string[]): string | null {
  const valid = values.map((value) => validIso(value)).filter((value): value is string => !!value);
  return valid.sort().at(-1) ?? null;
}

function sellerHistoryFromRow(row: Record<string, unknown>): SellerHistory {
  const stored = (row.seller_history ?? {}) as Record<string, unknown>;
  const marketplace = (row.seller_marketplace_data ?? {}) as Record<string, unknown>;
  return {
    currentActiveVehicleCount: nullableNumber(
      stored.currentActiveVehicleCount ?? marketplace.currentActiveVehicleCount,
    ),
    historicalVehicleCount: nullableNumber(stored.historicalVehicleCount) ?? 1,
    uniqueMakesCount: nullableNumber(stored.uniqueMakesCount) ?? 1,
    firstSeenSellerAt: nullableString(stored.firstSeenSellerAt),
    lastSeenSellerAt: nullableString(stored.lastSeenSellerAt),
  };
}
