import type { ListingAnalysis, PersistedListing } from '../domain/types.js';
import { formatPolishRelativeTimestamp } from '../services/publication-date.js';

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramMessage {
  message_id: number;
}

export class TelegramService {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async sendListing(
    listing: PersistedListing,
    analysis: ListingAnalysis,
    priceChanged: boolean,
  ): Promise<string> {
    const text = formatMessage(listing, analysis, priceChanged);
    return this.sendHtml(text, false);
  }

  async sendTestMessage(): Promise<string> {
    return this.sendHtml(
      '<b>✅ Car Hunter działa</b>\n\nPołączenie z botem Telegram zostało skonfigurowane poprawnie.',
      true,
    );
  }

  private async sendHtml(text: string, disablePreview: boolean): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await this.fetcher(
          `https://api.telegram.org/bot${this.botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: this.chatId,
              text,
              parse_mode: 'HTML',
              disable_web_page_preview: disablePreview,
            }),
            signal: AbortSignal.timeout(15_000),
          },
        );
        const payload = (await response.json()) as TelegramResponse<TelegramMessage>;
        if (!response.ok || !payload.ok || !payload.result) {
          throw new Error(payload.description ?? `Telegram HTTP ${response.status}`);
        }
        return String(payload.result.message_id);
      } catch (error) {
        lastError = error;
        if (attempt < 3) await delay(attempt * 250);
      }
    }
    throw lastError;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function formatMessage(
  listing: PersistedListing,
  analysis: ListingAnalysis,
  priceChanged: boolean,
  now: Date = new Date(),
): string {
  const priority = recommendationLabel(analysis);
  const change = priceChanged ? ' · 📉 ZMIANA CENY' : '';
  const sellerFacts = sellerSummary(analysis);
  const facts = [
    `🚘 Model: ${escapeHtml([listing.generation, listing.variant].filter(Boolean).join(' ') || listing.model)}`,
    listing.year ? `📅 ${listing.year}` : null,
    listing.mileageKm ? `🛣 ${formatNumber(listing.mileageKm)} km` : null,
    listing.fuelType !== 'unknown' ? `⛽ ${fuelLabel(listing.fuelType)}` : null,
    listing.gearbox !== 'unknown'
      ? `⚙️ ${listing.gearbox === 'automatic' ? 'Automat' : 'Manual'}`
      : null,
    listing.powerHp ? `🏎 ${listing.powerHp} KM` : null,
    listing.engineCapacityCc ? `🔩 ${formatNumber(listing.engineCapacityCc)} cm³` : null,
    analysis.likelyEngine !== 'unknown'
      ? `🔧 Prawdopodobny silnik: ${escapeHtml(engineLabel(analysis.likelyEngine))} (${Math.round(analysis.engineConfidence * 100)}%)`
      : null,
    listing.driveType !== 'unknown' ? `🚗 Napęd: ${listing.driveType.toUpperCase()}` : null,
    ...sellerFacts,
    listing.location ? `📍 ${escapeHtml(listing.location)}` : null,
    `🌐 Źródło: ${listing.source.toUpperCase()}`,
  ].filter(Boolean);
  const positives = analysis.positives.slice(0, 3).map((item) => `• ${escapeHtml(item)}`);
  const risks = analysis.redFlags.slice(0, 3).map((item) => `• ${escapeHtml(item)}`);
  const verification = analysis.verificationItems
    .slice(0, 4)
    .map((item) => `• ${escapeHtml(item)}`);
  const freshness = listing.publishedAt
    ? [
        `🕐 Opublikowano: ${formatPolishRelativeTimestamp(listing.publishedAt, now)}`,
        `👁 Wykryto: ${formatPolishRelativeTimestamp(listing.firstSeenAt, now)}`,
      ]
    : [
        '🕐 Data publikacji: brak danych',
        `👁 Pierwszy raz wykryto: ${formatPolishRelativeTimestamp(listing.firstSeenAt, now)}`,
      ];

  return [
    `<b>${priority} — ${analysis.totalScore}/100${change}</b>`,
    '',
    `<b>${escapeHtml(listing.title)}</b>`,
    listing.pricePln ? `${formatNumber(listing.pricePln)} zł` : 'Cena niepodana',
    '',
    ...facts,
    '',
    ...freshness,
    '',
    '<b>✅ Plusy</b>',
    ...(positives.length ? positives : ['• Brak potwierdzonych mocnych stron']),
    '',
    '<b>⚠️ Ryzyka</b>',
    ...(risks.length ? risks : ['• Brak oczywistych sygnałów w treści ogłoszenia']),
    '',
    '<b>🔎 Sprawdź przed wizytą</b>',
    ...verification,
    '',
    '<b>🤖 Werdykt</b>',
    escapeHtml(analysis.verdict),
    '',
    `<b>Następny krok:</b> ${actionLabel(analysis.recommendedAction)}`,
    `<a href="${escapeHtml(listing.url)}">👉 Otwórz ogłoszenie</a>`,
  ].join('\n');
}

export function recommendationLabel(
  analysis: Pick<
    ListingAnalysis,
    'totalScore' | 'analysisConfidence' | 'engineConfidence' | 'likelyEngine' | 'majorUncertainties'
  >,
): string {
  const urgent =
    analysis.totalScore >= 90 &&
    analysis.analysisConfidence >= 0.8 &&
    analysis.engineConfidence >= 0.8 &&
    !['unknown', 'N52B30_or_N53B30'].includes(analysis.likelyEngine) &&
    analysis.majorUncertainties.length === 0;
  if (urgent) return '🔥 PILNE';
  if (analysis.totalScore >= 80) return '⭐ BARDZO CIEKAWE';
  if (analysis.totalScore >= 70) return '🚗 REKOMENDOWANE';
  return '🔎 DO WERYFIKACJI';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pl-PL').format(value);
}

function fuelLabel(value: PersistedListing['fuelType']): string {
  return {
    petrol: 'Benzyna',
    diesel: 'Diesel',
    lpg: 'Benzyna + LPG',
    hybrid: 'Hybryda',
    electric: 'Elektryczny',
    unknown: 'Nieznane',
  }[value];
}

function sellerSummary(analysis: ListingAnalysis): string[] {
  if (analysis.sellerInferredType === 'private') return ['👤 Sprzedający: prywatny ✅'];
  if (analysis.sellerInferredType === 'likely_private')
    return ['👤 Sprzedający: prawdopodobnie prywatny ✅'];
  if (analysis.sellerInferredType === 'uncertain') return ['👤 Sprzedający: typ nieustalony ⚠️'];
  const label =
    analysis.sellerInferredType === 'dealer' ? 'handlarz/dealer' : 'prawdopodobnie handlarz';
  return [
    `👤 Sprzedający: ${label} ⚠️`,
    ...(analysis.sellerDeclaredType === 'private' ? ['Deklaruje: osoba prywatna'] : []),
    `Pewność: ${Math.round(analysis.sellerConfidence * 100)}%`,
  ];
}

function actionLabel(value: ListingAnalysis['recommendedAction']): string {
  return {
    ignore: 'pomiń',
    review: 'sprawdź ręcznie',
    call: 'skontaktuj się ze sprzedawcą',
    inspect: 'umów oględziny',
  }[value];
}

function engineLabel(value: ListingAnalysis['likelyEngine']): string {
  return value === 'N52B30_or_N53B30' ? 'N52B30 / N53B30 — do weryfikacji po VIN' : value;
}
