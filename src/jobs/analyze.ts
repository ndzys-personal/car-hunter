import 'dotenv/config';
import { GeminiProvider } from '../ai/gemini.js';
import { LISTING_ANALYSIS_PROMPT_VERSION } from '../ai/prompts/listing-analysis.js';
import { getRuntimeConfig } from '../config/env.js';
import { searchProfiles } from '../config/searches.js';
import { createSupabaseClient } from '../db/client.js';
import { CarHunterRepository } from '../db/repository.js';
import { scoreListing } from '../services/scoring.js';
import { TelegramService } from '../telegram/telegram.js';

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const hint = message.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED')
    ? ' The configured Gemini credential type is not accepted by the Google API.'
    : '';
  console.error(`AI analysis failed: ${message}${hint}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const listingId = process.argv[2]?.trim();
  if (!listingId) throw new Error('Usage: pnpm analyze <listing-id>');
  const sendToTelegram = process.argv.includes('--send');

  const config = getRuntimeConfig();
  if (!config.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY in .env first.');

  const repository = new CarHunterRepository(createSupabaseClient(config));
  const listing = await repository.getListingById(listingId);
  if (!listing) throw new Error(`Listing not found: ${listingId}`);

  const profile = searchProfiles.find((candidate) => candidate.id === listing.profileId);
  if (!profile) throw new Error(`Search profile not found: ${listing.profileId}`);

  const deterministicScore = scoreListing(listing, profile);
  const gemini = new GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL);
  const analysis = await gemini.analyze(listing, profile, deterministicScore);
  const analysisId = await repository.saveAnalysis(
    listing.id,
    listing.materialHash,
    gemini.name,
    gemini.model,
    LISTING_ANALYSIS_PROMPT_VERSION,
    analysis,
  );
  let telegramMessageId: string | undefined;
  if (sendToTelegram) {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
      throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env first.');
    }
    telegramMessageId = await new TelegramService(
      config.TELEGRAM_BOT_TOKEN,
      config.TELEGRAM_CHAT_ID,
    ).sendListing(listing, analysis, false);
  }

  console.log(
    JSON.stringify(
      {
        analysisId,
        listing: { id: listing.id, title: listing.title, url: listing.url },
        model: gemini.model,
        deterministicScore,
        analysis,
        ...(telegramMessageId ? { telegramMessageId } : {}),
      },
      null,
      2,
    ),
  );
}
