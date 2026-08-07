import { GeminiProvider } from '../ai/gemini.js';
import { getRuntimeConfig } from '../config/env.js';
import { enabledSearchScopes } from '../config/searches.js';
import { createSupabaseClient } from '../db/client.js';
import { CarHunterRepository } from '../db/repository.js';
import { logger } from '../services/logger.js';
import { TelegramService } from '../telegram/telegram.js';
import { parseCliArgs } from './cli.js';
import { runPipeline } from './pipeline.js';

const config = getRuntimeConfig();
const options = parseCliArgs(process.argv.slice(2));
const repository = new CarHunterRepository(createSupabaseClient(config));

if (!(await repository.isBaselineCompleted(enabledSearchScopes()))) {
  logger.error(
    'Baseline is not completed. Run `pnpm baseline` before enabling scheduled scans. No notifications were sent.',
  );
  process.exitCode = 2;
} else {
  const ai =
    !options.skipAi && config.GEMINI_API_KEY
      ? new GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL)
      : undefined;
  const telegram =
    config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID
      ? new TelegramService(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID)
      : undefined;
  if (!ai) logger.warn('Gemini is unavailable; scan stores deterministic results only');
  if (!telegram) logger.warn('Telegram is unavailable; no notifications will be sent');
  await runPipeline(config, repository, { mode: 'scan', ...options }, ai, telegram);
}
