import type { EngineCode, Listing } from '../domain/types.js';

export interface EngineInference {
  engine: EngineCode;
  confidence: number;
  evidence: string[];
}

export function inferEngine(
  listing: Pick<
    Listing,
    'title' | 'description' | 'variant' | 'year' | 'fuelType' | 'engineCapacityCc' | 'powerHp'
  >,
): EngineInference {
  const text = `${listing.title} ${listing.description}`.toUpperCase();
  const explicit = text.match(/\b(N52B25|N52B30|M57(?:D30)?)\b/)?.[1];
  if (explicit) {
    const engine = explicit.startsWith('M57') ? 'M57' : (explicit as 'N52B25' | 'N52B30');
    return { engine, confidence: 0.9, evidence: [`Kod ${explicit} podany w ogłoszeniu`] };
  }

  const evidence: string[] = [];
  const variant = listing.variant?.toLowerCase() ?? '';
  if (listing.fuelType === 'diesel' || /\b(320D|325D|330D|525D|530D)\b/.test(text)) {
    const sixCylinderVariant = /325d|330d|525d|530d/i.test(variant);
    const sixCylinderCapacity = (listing.engineCapacityCc ?? 0) >= 2400;
    if (sixCylinderVariant && (sixCylinderCapacity || listing.engineCapacityCc === null)) {
      evidence.push('sześciocylindrowy wariant wysokoprężny z okresu M57');
      const confidence = (listing.engineCapacityCc ?? 0) >= 2900 ? 0.7 : 0.62;
      return { engine: 'M57', confidence, evidence };
    }
    return {
      engine: 'unknown',
      confidence: 0.35,
      evidence: ['wariant wysokoprężny bez wystarczających przesłanek dla M57'],
    };
  }

  if (listing.fuelType === 'petrol' || /\b(325I|330I|525I|530I)\b/.test(text)) {
    const isThreeLiter =
      /325i|330i|525i|530i/i.test(variant) && between(listing.engineCapacityCc, 2900, 3100);
    const isTwoAndHalf =
      /325i|525i/i.test(variant) && between(listing.engineCapacityCc, 2400, 2600);
    const power = listing.powerHp ?? 0;
    const n52Era = (listing.year ?? 0) >= 2004 && (listing.year ?? 9999) <= 2011;
    if (isThreeLiter && n52Era) {
      evidence.push('wariant 3.0 benzyna, w którym możliwe są N52B30 i N53B30');
      return { engine: 'N52B30_or_N53B30', confidence: power > 0 ? 0.65 : 0.55, evidence };
    }
    if (isTwoAndHalf && n52Era) {
      evidence.push('wariant 2.5 benzyna z okresu N52');
      return { engine: 'N52B25', confidence: power >= 190 ? 0.7 : 0.6, evidence };
    }
    if (listing.engineCapacityCc === null && n52Era && /325i|525i|330i|530i/i.test(variant)) {
      evidence.push('wariant benzynowy z okresu N52, ale brak pojemności silnika');
      return { engine: 'unknown', confidence: 0.45, evidence };
    }
  }

  return { engine: 'unknown', confidence: 0.2, evidence: ['brak wystarczających danych'] };
}

function between(value: number | null, min: number, max: number): boolean {
  return value !== null && value >= min && value <= max;
}
