import type { Listing, SellerAssessment, SellerInferredType } from '../domain/types.js';

interface WeightedSignal {
  pattern: RegExp;
  weight: number;
  message: string;
}

const dealerSignals: WeightedSignal[] = [
  {
    pattern: /vat\s*mar[zż]a|faktur[ay]\s+vat|mo[zż]liwo[sś][cć].{0,25}faktur/i,
    weight: 20,
    message: 'Sprzedający oferuje fakturę VAT lub VAT marża.',
  },
  {
    pattern: /leasing|kredyt|raty|finansowani/i,
    weight: 20,
    message: 'Sprzedający oferuje finansowanie, raty lub leasing.',
  },
  {
    pattern: /w rozliczeniu|przyjmujemy auta|zamian[ayę]/i,
    weight: 16,
    message: 'Sprzedający oferuje zamianę lub przyjęcie auta w rozliczeniu.',
  },
  {
    pattern:
      /transport auta|dostaw[ay].{0,20}(auta|samochodu)|gwarancj[ai].{0,20}(pisemn|dealersk)/i,
    weight: 16,
    message: 'Oferta obejmuje transport lub profesjonalną gwarancję.',
  },
  {
    pattern: /\bNIP\b|sp\.\s*z\s*o\.\s*o\.|dzia[lł]alno[sś][cć]|firma\s+[A-ZĄĆĘŁŃÓŚŹŻ]/,
    weight: 24,
    message: 'W ogłoszeniu występują dane lub oznaczenia firmowe.',
  },
  {
    pattern: /komis|salon|plac.{0,20}(samochod|aut)|showroom/i,
    weight: 20,
    message: 'Treść wskazuje na komis, salon lub plac samochodowy.',
  },
  {
    pattern: /zapraszamy|nasza oferta|posiadamy inne samochody|wi[eę]cej aut na profilu/i,
    weight: 15,
    message: 'Opis używa języka charakterystycznego dla stałej oferty handlowej.',
  },
];

const privateSignals: WeightedSignal[] = [
  {
    pattern: /mam (?:to )?auto od\s+\d+|jestem w[lł]a[sś]cicielem od|w moich r[eę]kach od/i,
    weight: -14,
    message: 'Sprzedający opisuje długość własnego użytkowania auta.',
  },
  {
    pattern:
      /sprzedaj[eę] z powodu|pow[oó]d sprzeda[zż]y|samoch[oó]d (?:mojej )?(?:[zż]ony|m[eę][zż]a)/i,
    weight: -12,
    message: 'Podano osobisty powód sprzedaży lub rodzinny kontekst użytkowania.',
  },
  {
    pattern:
      /auto u[zż]ytkowane przeze mnie|u[zż]ywa[lł]em|doje[zż]d[zż]a[lł]em|je[zż]d[zż]i[lł]em/i,
    weight: -10,
    message: 'Opis zawiera naturalny kontekst codziennego użytkowania.',
  },
  {
    pattern: /wymienia[lł]em|robi[lł]em|zleci[lł]em|mam faktury z mojego okresu/i,
    weight: -10,
    message: 'Sprzedający opisuje naprawy wykonane w swoim okresie użytkowania.',
  },
];

export function detectSellerType(listing: Listing): SellerAssessment {
  const text = [
    listing.title,
    listing.description,
    listing.sellerCompanyName ?? '',
    listing.sellerBusinessSignals.join(' '),
  ].join(' ');
  let probability =
    listing.declaredSellerType === 'dealer'
      ? 0.75
      : listing.declaredSellerType === 'private'
        ? 0.25
        : 0.4;
  const signals: string[] = [];

  if (listing.declaredSellerType === 'private')
    signals.push('Ogłoszenie oznaczone jako osoba prywatna.');
  if (listing.declaredSellerType === 'dealer')
    signals.push('Ogłoszenie oznaczone jako firma/dealer.');

  for (const signal of dealerSignals) {
    if (!signal.pattern.test(text)) continue;
    probability += signal.weight / 100;
    signals.push(signal.message);
  }
  for (const signal of privateSignals) {
    if (!signal.pattern.test(text)) continue;
    probability += signal.weight / 100;
    signals.push(signal.message);
  }

  if (/sprowadzon[ay].{0,40}(niemiec|szwajcarii|holandii|belgii)/i.test(text)) {
    probability += 0.05;
    signals.push(
      'Auto jest opisane jako sprowadzone; sam import nie przesądza o typie sprzedawcy.',
    );
  }
  if (
    /przygotowan[ey].{0,25}rejestracji|op[lł]at.{0,25}(celn|akcyz)|tablic[ey] (?:tymczas|wywoz)/i.test(
      text,
    )
  ) {
    probability += 0.1;
    signals.push('Opis formalności importowych przypomina ofertę zawodowego importera.');
  }

  const activeCount =
    listing.currentActiveVehicleCount ??
    (listing.otherVehicleIds.length ? listing.otherVehicleIds.length + 1 : null) ??
    listing.sellerHistory.currentActiveVehicleCount;
  if (activeCount !== null && activeCount >= 6) {
    probability += 0.3;
    signals.push(`Sprzedający ma obecnie ${activeCount} aktywnych ogłoszeń pojazdów.`);
  } else if (activeCount !== null && activeCount >= 3) {
    probability += 0.16;
    signals.push(`Sprzedający ma obecnie ${activeCount} aktywne ogłoszenia pojazdów.`);
  } else if (activeCount === 2) {
    probability += 0.03;
    signals.push('Sprzedający ma dwa aktywne ogłoszenia; sam ten fakt nie przesądza o handlu.');
  } else if (activeCount === 1) {
    probability -= 0.05;
    signals.push('Publiczny profil pokazuje jedno aktywne ogłoszenie pojazdu.');
  }

  const historicalCount = listing.sellerHistory.historicalVehicleCount;
  if (historicalCount >= 10) {
    probability += 0.45;
    signals.push(
      `Car Hunter widział wcześniej łącznie ${historicalCount} różnych pojazdów tego sprzedającego.`,
    );
  } else if (historicalCount >= 5) {
    probability += 0.28;
    signals.push(
      `Car Hunter widział wcześniej łącznie ${historicalCount} różnych pojazdów tego sprzedającego.`,
    );
  } else if (historicalCount >= 3) {
    probability += 0.14;
    signals.push(
      `Car Hunter widział wcześniej łącznie ${historicalCount} różne pojazdy tego sprzedającego.`,
    );
  }

  if (listing.sellerHistory.uniqueMakesCount >= 4) {
    probability += 0.15;
    signals.push(
      `Historia sprzedającego obejmuje ${listing.sellerHistory.uniqueMakesCount} różnych marek.`,
    );
  }
  if (listing.otherVehicleMakes.length >= 4) {
    probability += 0.15;
    signals.push(
      `Publiczna oferta obejmuje co najmniej ${listing.otherVehicleMakes.length} różne marki.`,
    );
  }
  if (listing.sellerCompanyName) {
    probability += 0.2;
    signals.push(`Publicznie podana nazwa firmy: ${listing.sellerCompanyName}.`);
  }
  for (const signal of listing.sellerBusinessSignals) signals.push(signal);

  const confidence = clamp(probability);
  const inferredType = sellerTypeFromDealerProbability(confidence);
  return {
    inferredType,
    confidence,
    signals: unique(signals).slice(0, 10),
    riskExplanation: riskExplanation(inferredType),
  };
}

export function sellerTypeFromDealerProbability(probability: number): SellerInferredType {
  if (probability <= 0.2) return 'private';
  if (probability <= 0.4) return 'likely_private';
  if (probability < 0.6) return 'uncertain';
  if (probability < 0.8) return 'likely_dealer';
  return 'dealer';
}

export function scoreSellerAssessment(
  assessment: SellerAssessment,
  preferences: {
    privateBonus: number;
    likelyPrivateBonus: number;
    likelyDealerPenalty: number;
    dealerPenalty: number;
  },
): number {
  return {
    private: preferences.privateBonus,
    likely_private: preferences.likelyPrivateBonus,
    uncertain: 0,
    likely_dealer: -preferences.likelyDealerPenalty,
    dealer: -preferences.dealerPenalty,
  }[assessment.inferredType];
}

function riskExplanation(type: SellerInferredType): string {
  if (type === 'dealer')
    return 'Zestaw niezależnych sygnałów wyraźnie wskazuje na zawodową sprzedaż samochodów.';
  if (type === 'likely_dealer')
    return 'Profil sprzedaży bardziej przypomina działalność handlową niż okazjonalną sprzedaż prywatną.';
  if (type === 'uncertain')
    return 'Dostępne sygnały są mieszane lub zbyt słabe, aby wiarygodnie określić typ sprzedającego.';
  if (type === 'private')
    return 'Dostępne informacje są spójne z rzeczywistym prywatnym użytkownikiem auta.';
  return 'Dostępne informacje raczej wskazują na prywatnego właściciela, ale nie są rozstrzygające.';
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
