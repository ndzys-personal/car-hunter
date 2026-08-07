import type { ListingAnalysis, PersistedListing } from '../domain/types.js';

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
  ) {}

  async sendRecommendedListing(
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
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: disablePreview,
      }),
    });
    const payload = (await response.json()) as TelegramResponse<TelegramMessage>;
    if (!response.ok || !payload.ok || !payload.result) {
      throw new Error(payload.description ?? `Telegram HTTP ${response.status}`);
    }
    return String(payload.result.message_id);
  }
}

export function formatMessage(
  listing: PersistedListing,
  analysis: ListingAnalysis,
  priceChanged: boolean,
): string {
  const priority = analysis.totalScore >= 85 ? '🔥 PILNE' : '🚗 REKOMENDOWANE';
  const change = priceChanged ? ' · 📉 ZMIANA CENY' : '';
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
      ? `🔧 Prawdopodobny silnik: ${escapeHtml(analysis.likelyEngine)} (${Math.round(analysis.engineConfidence * 100)}%)`
      : null,
    listing.driveType !== 'unknown' ? `🚗 Napęd: ${listing.driveType.toUpperCase()}` : null,
    `👤 Sprzedający: ${sellerLabel(analysis.sellerType)} (${Math.round(analysis.sellerConfidence * 100)}%)`,
    listing.location ? `📍 ${escapeHtml(listing.location)}` : null,
    `🌐 Źródło: ${listing.source.toUpperCase()}`,
  ].filter(Boolean);
  const positives = analysis.positives.slice(0, 3).map((item) => `• ${escapeHtml(item)}`);
  const risks = analysis.redFlags.slice(0, 3).map((item) => `• ${escapeHtml(item)}`);

  return [
    `<b>${priority} — ${analysis.totalScore}/100${change}</b>`,
    '',
    `<b>${escapeHtml(listing.title)}</b>`,
    listing.pricePln ? `${formatNumber(listing.pricePln)} zł` : 'Cena niepodana',
    '',
    ...facts,
    '',
    '<b>✅ Plusy</b>',
    ...(positives.length ? positives : ['• Brak potwierdzonych mocnych stron']),
    '',
    '<b>⚠️ Ryzyka</b>',
    ...(risks.length ? risks : ['• Brak oczywistych sygnałów w treści ogłoszenia']),
    '',
    '<b>🤖 Werdykt</b>',
    escapeHtml(analysis.verdict),
    '',
    `<b>Następny krok:</b> ${actionLabel(analysis.recommendedAction)}`,
    `<a href="${escapeHtml(listing.url)}">👉 Otwórz ogłoszenie</a>`,
  ].join('\n');
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

function sellerLabel(value: ListingAnalysis['sellerType']): string {
  return { private: 'prywatny', dealer: 'dealer', uncertain: 'niepewny' }[value];
}

function actionLabel(value: ListingAnalysis['recommendedAction']): string {
  return { ignore: 'pomiń', review: 'sprawdź ręcznie', call: 'zadzwoń', inspect: 'umów oględziny' }[
    value
  ];
}
