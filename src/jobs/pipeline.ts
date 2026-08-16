import type { RuntimeConfig } from '../config/env.js';
import { enabledSearchScopes, searchProfiles } from '../config/searches.js';
import { LISTING_ANALYSIS_PROMPT_VERSION } from '../ai/prompts/listing-analysis.js';
import type { AiProvider } from '../ai/provider.js';
import { CarHunterRepository } from '../db/repository.js';
import type { SourceName } from '../domain/types.js';
import { normalizeListing } from '../services/normalization.js';
import { logger } from '../services/logger.js';
import { createFallbackAnalysis } from '../services/fallback-analysis.js';
import { createAdapters } from '../sources/index.js';
import { TelegramService } from '../telegram/telegram.js';
import type { VehicleHistoryService } from '../history/service.js';

export interface PipelineOptions {
  mode: 'baseline' | 'scan';
  skipAi: boolean;
  source?: SourceName;
  profile?: string;
}

export async function runPipeline(
  config: RuntimeConfig,
  repository: CarHunterRepository,
  options: PipelineOptions,
  aiProvider?: AiProvider,
  telegram?: TelegramService,
  historyService?: VehicleHistoryService,
): Promise<void> {
  const runId = await repository.startRun(options.mode, { ...options });
  const counts = { discovered: 0, processed: 0, errors: 0 };
  let pendingNotificationIds = new Set<string>();
  const adapters = createAdapters({
    headless: config.HEADLESS,
    maxListings: config.MAX_LISTINGS_PER_SOURCE,
    maxSearchPages: config.MAX_SEARCH_PAGES,
    detailConcurrency: config.DETAIL_CONCURRENCY,
  });

  try {
    if (options.mode === 'scan' && telegram) {
      pendingNotificationIds = await repository.getPendingNotificationListingIds();
      if (pendingNotificationIds.size > 0) {
        logger.warn(
          { pendingNotifications: pendingNotificationIds.size },
          'Recovering post-baseline listings that were never delivered',
        );
      }
    }
    const profiles = searchProfiles.filter(
      (profile) => !options.profile || profile.id === options.profile,
    );
    for (const profile of profiles) {
      for (const sourceName of Object.keys(profile.sources) as SourceName[]) {
        if (options.source && options.source !== sourceName) continue;
        const sourceConfig = profile.sources[sourceName];
        if (!sourceConfig.enabled) continue;

        try {
          const fetchResult = await adapters[sourceName].fetchListings(
            profile,
            sourceConfig.searchUrl,
          );
          const rawListings = fetchResult.listings;
          counts.errors += fetchResult.errors;
          counts.discovered += rawListings.length;
          for (const raw of rawListings) {
            try {
              const listing = normalizeListing(raw, profile);
              const persistedResult = await repository.upsertListing(listing, profile, runId);
              const persisted = persistedResult.listing;
              const score = persistedResult.score;
              counts.processed += 1;

              const recoveringNotification = pendingNotificationIds.has(persisted.id);
              const notificationEvent = isNotificationEvent(
                persisted.isNew,
                recoveringNotification,
              );

              if (recoveringNotification && telegram) {
                await sendFallbackNotification(
                  repository,
                  telegram,
                  persisted,
                  score,
                  'missed_listing_recovery_fallback',
                );
                continue;
              }

              const eligibleForAi = shouldAnalyzeListing({
                mode: options.mode,
                skipAi: options.skipAi,
                aiAvailable: Boolean(aiProvider),
                isNew: persisted.isNew,
                rejected: score.rejected,
                totalScore: score.totalScore,
                threshold: config.AI_SCORE_THRESHOLD,
              });
              const shouldSend = Boolean(
                telegram &&
                shouldAttemptTelegram(options.mode, persisted.isNew, recoveringNotification),
              );
              if (!eligibleForAi || !aiProvider) {
                if (shouldSend && telegram) {
                  await sendFallbackNotification(
                    repository,
                    telegram,
                    persisted,
                    score,
                    recoveringNotification
                      ? 'missed_listing_recovery_fallback'
                      : 'new_listing_fallback',
                  );
                }
                continue;
              }

              let vehicleHistory: Awaited<ReturnType<VehicleHistoryService['analyze']>> | undefined;
              let analysis = createFallbackAnalysis(persisted, score);
              let analysisId: string | undefined;
              try {
                vehicleHistory = historyService
                  ? await historyService.analyze(persisted)
                  : undefined;
                const historyFingerprint = vehicleHistory?.fingerprint ?? 'none';
                const cached = await repository.getCachedAnalysis(
                  persisted.id,
                  persisted.materialHash,
                  LISTING_ANALYSIS_PROMPT_VERSION,
                  historyFingerprint,
                );
                const hasOlderPromptAnalysis = cached
                  ? false
                  : await repository.hasAnalysisForMaterial(persisted.id, persisted.materialHash);
                const needsAnalysis =
                  options.mode === 'baseline' ||
                  notificationEvent ||
                  persisted.materiallyChanged ||
                  hasOlderPromptAnalysis;
                if (!needsAnalysis) continue;
                analysis =
                  cached ?? (await aiProvider.analyze(persisted, profile, score, vehicleHistory));
                analysisId = await repository.saveAnalysis(
                  persisted.id,
                  persisted.materialHash,
                  aiProvider.name,
                  aiProvider.model,
                  LISTING_ANALYSIS_PROMPT_VERSION,
                  analysis,
                  historyFingerprint,
                );
              } catch (error) {
                counts.errors += 1;
                logger.error(
                  { error, listingId: persisted.id },
                  'Listing enrichment failed; sending deterministic fallback notification',
                );
              }

              if (!shouldSend || !telegram) continue;
              const alreadyNotified = await repository.wasNotified(
                persisted.id,
                persisted.materialHash,
              );
              if (shouldNotify(alreadyNotified)) {
                const priceChanged = isMeaningfulPriceDrop(
                  persisted.previousPricePln,
                  persisted.pricePln,
                );
                try {
                  const messageId = await telegram.sendListing(
                    persisted,
                    analysis,
                    priceChanged,
                    vehicleHistory,
                  );
                  await repository.saveNotification({
                    listingId: persisted.id,
                    ...(analysisId ? { analysisId } : {}),
                    materialHash: persisted.materialHash,
                    reason: recoveringNotification
                      ? analysisId
                        ? 'missed_listing_recovery'
                        : 'missed_listing_recovery_fallback'
                      : analysisId
                        ? 'new_listing'
                        : 'new_listing_fallback',
                    totalScore: analysis.totalScore,
                    recommendedAction: analysis.recommendedAction,
                    telegramMessageId: messageId,
                  });
                } catch (error) {
                  if (isFatalPipelineError(error)) throw error;
                  counts.errors += 1;
                  logger.error(
                    { error, listingId: persisted.id },
                    'Telegram notification failed; scan continues',
                  );
                }
              }
            } catch (error) {
              if (isFatalPipelineError(error)) throw error;
              counts.errors += 1;
              logger.error(
                { error, source: sourceName, url: raw.url },
                'Listing processing failed',
              );
            }
          }
        } catch (error) {
          if (isFatalPipelineError(error)) throw error;
          counts.errors += 1;
          logger.error(
            { error, source: sourceName, profile: profile.id },
            'Source failed; other sources continue',
          );
        }
      }
    }

    const baselineCanComplete = canCompleteBaseline(options, counts);
    if (baselineCanComplete) await repository.markBaselineCompleted(enabledSearchScopes());
    if (options.mode === 'baseline' && !baselineCanComplete) {
      logger.warn(
        { ...counts, filtered: Boolean(options.source || options.profile) },
        'Baseline data was stored, but global baseline state was not completed',
      );
    }
    await repository.finishRun(runId, counts.errors > 0 ? 'partial' : 'completed', counts);
    logger.info({ runId, mode: options.mode, ...counts }, 'Car Hunter run completed');
  } catch (error) {
    await repository.finishRun(runId, 'failed', counts).catch(() => undefined);
    throw error;
  }
}

async function sendFallbackNotification(
  repository: CarHunterRepository,
  telegram: TelegramService,
  listing: Parameters<typeof createFallbackAnalysis>[0],
  score: Parameters<typeof createFallbackAnalysis>[1],
  reason: 'new_listing_fallback' | 'missed_listing_recovery_fallback',
): Promise<void> {
  if (await repository.wasNotified(listing.id, listing.materialHash)) return;
  const analysis = createFallbackAnalysis(listing, score);
  const messageId = await telegram.sendListing(
    listing,
    analysis,
    isMeaningfulPriceDrop(listing.previousPricePln, listing.pricePln),
  );
  await repository.saveNotification({
    listingId: listing.id,
    materialHash: listing.materialHash,
    reason,
    totalScore: analysis.totalScore,
    recommendedAction: analysis.recommendedAction,
    telegramMessageId: messageId,
  });
}

export function isMeaningfulPriceDrop(previous: number | null, current: number | null): boolean {
  if (previous === null || current === null || current >= previous) return false;
  const drop = previous - current;
  return drop >= 1_000 || drop / previous >= 0.03;
}

export function isNotificationEvent(isNew: boolean, recovering = false): boolean {
  return isNew || recovering;
}

export function shouldAttemptTelegram(
  mode: PipelineOptions['mode'],
  isNew: boolean,
  recovering = false,
): boolean {
  return mode === 'scan' && isNotificationEvent(isNew, recovering);
}

export function isFatalPipelineError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String(error.code);
  return /^[0-9A-Z]{5}$/.test(code) || code.startsWith('PGRST');
}

export function shouldAnalyzeListing(input: {
  mode: PipelineOptions['mode'];
  skipAi: boolean;
  aiAvailable: boolean;
  isNew: boolean;
  rejected: boolean;
  totalScore: number;
  threshold: number;
}): boolean {
  if (input.skipAi || !input.aiAvailable) return false;
  return !input.rejected && input.totalScore >= input.threshold;
}

export function shouldNotify(alreadyNotified: boolean): boolean {
  return !alreadyNotified;
}

export function canCompleteBaseline(
  options: PipelineOptions,
  counts: { processed: number; errors: number },
): boolean {
  return (
    options.mode === 'baseline' &&
    !options.source &&
    !options.profile &&
    counts.errors === 0 &&
    counts.processed > 0
  );
}
