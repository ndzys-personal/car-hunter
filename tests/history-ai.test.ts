import { expect, it } from 'vitest';
import { buildListingAnalysisContents } from '../src/ai/gemini.js';
import { LISTING_ANALYSIS_SYSTEM_PROMPT } from '../src/ai/prompts/listing-analysis.js';
import { searchProfiles } from '../src/config/searches.js';
import { analyzeVehicleHistory } from '../src/history/analysis.js';
import { normalizeListing } from '../src/services/normalization.js';
import { scoreListing } from '../src/services/scoring.js';
import { rawListing } from './fixtures.js';

it('passes structured evidence to AI and explicitly separates facts from inference', () => {
  const listing = normalizeListing(rawListing(), searchProfiles[0]!);
  const history = analyzeVehicleHistory(listing, []);
  const contents = buildListingAnalysisContents(
    listing,
    searchProfiles[0]!,
    scoreListing(listing, searchProfiles[0]!),
    history,
  );
  expect(contents).toContain('"vehicleHistory"');
  expect(contents).toContain('"historySignals"');
  expect(LISTING_ANALYSIS_SYSTEM_PROMPT).toContain(
    'Zawsze oddzielaj potwierdzone fakty od przypuszczeń.',
  );
  expect(LISTING_ANALYSIS_SYSTEM_PROMPT).toMatch(/possible_flip.*nie potwierdzony fakt/i);
});
