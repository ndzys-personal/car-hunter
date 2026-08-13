import { GeminiProvider } from '../ai/gemini.js';
import { getRuntimeConfig } from '../config/env.js';
import { createSupabaseClient } from '../db/client.js';
import { CarHunterRepository } from '../db/repository.js';
import { logger } from '../services/logger.js';
import { parseCliArgs } from './cli.js';
import { runPipeline } from './pipeline.js';
import { PublicWebVehicleHistoryProvider } from '../history/public-web-provider.js';
import { VehicleHistoryService } from '../history/service.js';

const config = getRuntimeConfig();
const options = parseCliArgs(process.argv.slice(2));
const repository = new CarHunterRepository(createSupabaseClient(config));
const ai =
  !options.skipAi && config.GEMINI_API_KEY
    ? new GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL)
    : undefined;

if (!options.skipAi && !ai) logger.warn('GEMINI_API_KEY is missing; baseline continues without AI');
const history = new VehicleHistoryService(
  repository,
  config.HISTORY_SEARCH_ENABLED ? [new PublicWebVehicleHistoryProvider()] : [],
  config.HISTORY_SEARCH_TTL_DAYS * 86_400_000,
);
await runPipeline(config, repository, { mode: 'baseline', ...options }, ai, undefined, history);
