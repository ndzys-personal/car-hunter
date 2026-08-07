const WARSAW_TIME_ZONE = 'Europe/Warsaw';
const DAY_MS = 86_400_000;

const polishMonths: Record<string, number> = {
  stycznia: 1,
  styczen: 1,
  sty: 1,
  lutego: 2,
  luty: 2,
  lut: 2,
  marca: 3,
  marzec: 3,
  mar: 3,
  kwietnia: 4,
  kwiecien: 4,
  kwi: 4,
  maja: 5,
  maj: 5,
  czerwca: 6,
  czerwiec: 6,
  cze: 6,
  lipca: 7,
  lipiec: 7,
  lip: 7,
  sierpnia: 8,
  sierpien: 8,
  sie: 8,
  wrzesnia: 9,
  wrzesien: 9,
  wrz: 9,
  pazdziernika: 10,
  pazdziernik: 10,
  paz: 10,
  listopada: 11,
  listopad: 11,
  lis: 11,
  grudnia: 12,
  grudzien: 12,
  gru: 12,
};

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function parseMarketplacePublishedAt(
  value: string | null | undefined,
  observedAt: string | Date,
  timeZone = WARSAW_TIME_ZONE,
): string | null {
  const raw = value?.replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const observed = new Date(observedAt);
  if (!Number.isFinite(observed.getTime())) return null;
  const normalized = normalizePolish(raw);

  const zonedIso = parseZonedIso(raw);
  if (zonedIso) return validateCandidate(zonedIso, observed);

  const localIso = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (localIso) {
    return validateParts(
      {
        year: Number(localIso[1]),
        month: Number(localIso[2]),
        day: Number(localIso[3]),
        hour: Number(localIso[4] ?? 0),
        minute: Number(localIso[5] ?? 0),
        second: Number(localIso[6] ?? 0),
      },
      observed,
      timeZone,
    );
  }

  const relative = normalized.match(/^(dzisiaj|wczoraj)(?:[, ]+(?:o )?(\d{1,2}):(\d{2}))?$/);
  if (relative) {
    const observedParts = getZonedParts(observed, timeZone);
    const dayOffset = relative[1] === 'wczoraj' ? 1 : 0;
    const localDay = new Date(
      Date.UTC(observedParts.year, observedParts.month - 1, observedParts.day) - dayOffset * DAY_MS,
    );
    return validateParts(
      {
        year: localDay.getUTCFullYear(),
        month: localDay.getUTCMonth() + 1,
        day: localDay.getUTCDate(),
        hour: Number(relative[2] ?? 0),
        minute: Number(relative[3] ?? 0),
        second: 0,
      },
      observed,
      timeZone,
    );
  }

  const numeric = normalized.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[, ]+(?:o )?(\d{1,2}):(\d{2}))?$/,
  );
  if (numeric) {
    return validateParts(
      {
        year: Number(numeric[3]),
        month: Number(numeric[2]),
        day: Number(numeric[1]),
        hour: Number(numeric[4] ?? 0),
        minute: Number(numeric[5] ?? 0),
        second: 0,
      },
      observed,
      timeZone,
    );
  }

  const named = normalized.match(/^(\d{1,2}) ([a-z]+) (\d{4})(?:[, ]+(?:o )?(\d{1,2}):(\d{2}))?$/);
  const month = named?.[2] ? polishMonths[named[2]] : undefined;
  if (named && month) {
    return validateParts(
      {
        year: Number(named[3]),
        month,
        day: Number(named[1]),
        hour: Number(named[4] ?? 0),
        minute: Number(named[5] ?? 0),
        second: 0,
      },
      observed,
      timeZone,
    );
  }

  return null;
}

export function formatPolishRelativeTimestamp(
  value: string,
  now: Date = new Date(),
  timeZone = WARSAW_TIME_ZONE,
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'brak danych';
  const valueParts = getZonedParts(date, timeZone);
  const nowParts = getZonedParts(now, timeZone);
  const dayDifference = Math.round(
    (Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day) -
      Date.UTC(valueParts.year, valueParts.month - 1, valueParts.day)) /
      DAY_MS,
  );
  const time = `${pad(valueParts.hour)}:${pad(valueParts.minute)}`;
  if (dayDifference === 0) return `dzisiaj, ${time}`;
  if (dayDifference === 1) return `wczoraj, ${time}`;
  if (dayDifference > 1 && dayDifference <= 30) return `${dayDifference} dni temu`;
  return `${pad(valueParts.day)}.${pad(valueParts.month)}.${valueParts.year}, ${time}`;
}

function parseZonedIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))
    return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function validateParts(parts: DateParts, observed: Date, timeZone: string): string | null {
  if (!validParts(parts)) return null;
  const candidate = zonedDateTimeToUtc(parts, timeZone);
  return candidate ? validateCandidate(candidate, observed) : null;
}

function validateCandidate(candidate: Date, observed: Date): string | null {
  if (candidate.getTime() > observed.getTime() + 5 * 60_000) return null;
  return candidate.toISOString();
}

function validParts(parts: DateParts): boolean {
  if (
    parts.year < 2000 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59 ||
    parts.second < 0 ||
    parts.second > 59
  )
    return false;
  const roundTrip = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return (
    roundTrip.getUTCFullYear() === parts.year &&
    roundTrip.getUTCMonth() + 1 === parts.month &&
    roundTrip.getUTCDate() === parts.day
  );
}

function zonedDateTimeToUtc(parts: DateParts, timeZone: string): Date | null {
  const target = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = new Date(target);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const represented = getZonedParts(candidate, timeZone);
    const representedUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    candidate = new Date(candidate.getTime() + (target - representedUtc));
  }
  const finalParts = getZonedParts(candidate, timeZone);
  return Object.keys(parts).every(
    (key) => finalParts[key as keyof DateParts] === parts[key as keyof DateParts],
  )
    ? candidate
    : null;
}

function getZonedParts(value: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

function normalizePolish(value: string): string {
  return value
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
