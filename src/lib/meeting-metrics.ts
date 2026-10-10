export const MEETING_METRICS_TIME_ZONE = "Europe/Lisbon";

export type MeetingMetricGrain = "day" | "week" | "month";
export type MeetingMetricKind = "external" | "internal" | "all";
export type MeetingMetricsPreset = "30d" | "12w" | "12m" | "all" | "custom";

type RpcCount = number | string | bigint | null;

/** Row returned by public.meeting_metrics. */
export interface MeetingMetricBucketRpc {
  bucket_start: string;
  meeting_count: RpcCount;
  participation_count: RpcCount;
  scheduled_count: RpcCount;
  held_count: RpcCount;
  cancelled_count: RpcCount;
  no_show_count: RpcCount;
  unknown_count: RpcCount;
  tentative_count: RpcCount;
}

export interface MeetingMetricBucket {
  bucketStart: string;
  meetingCount: number;
  participationCount: number;
  scheduledCount: number;
  heldCount: number;
  cancelledCount: number;
  noShowCount: number;
  unknownCount: number;
  tentativeCount: number;
}

export interface MeetingMetricsInterval {
  preset: MeetingMetricsPreset;
  timeZone: string;
  /** Inclusive instant sent to p_from. */
  from: string;
  /** Exclusive instant sent to p_to. */
  to: string;
  /** Local calendar date in timeZone. */
  fromDate: string;
  /** Exclusive local calendar date in timeZone. */
  toDateExclusive: string;
  label: string;
}

export interface MeetingChartRow extends MeetingMetricBucket {
  label: string;
  isPartial: boolean;
  isCurrentPartial: boolean;
}

export interface MeetingMetricTotals {
  meetings: number;
  participations: number;
  scheduled: number;
  held: number;
  cancelled: number;
  noShow: number;
  unknown: number;
  tentative: number;
}

export interface MeetingSummary {
  totalMeetings: number;
  totalParticipations: number;
  totals: MeetingMetricTotals;
  averages: Record<MeetingMetricGrain, number | null>;
  completedBuckets: Record<MeetingMetricGrain, number>;
  hasCurrentPartial: Record<MeetingMetricGrain, boolean>;
}

export interface MeetingPeriodComparison {
  current: number;
  previous: number;
  absoluteChange: number;
  percentageChange: number | null;
  direction: "up" | "down" | "flat";
}

export const MEETING_METRICS_PRESETS: ReadonlyArray<{ value: MeetingMetricsPreset; label: string }> = [
  { value: "30d", label: "30 dias" },
  { value: "12w", label: "12 semanas" },
  { value: "12m", label: "12 meses" },
  { value: "all", label: "Todo o histórico" },
  { value: "custom", label: "Personalizado" },
];

export const meetingGrainLabels: Record<MeetingMetricGrain, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
};

export const meetingKindLabels: Record<MeetingMetricKind, string> = {
  external: "Externas",
  internal: "Internas",
  all: "Todas",
};

const dateFormatter = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-PT", {
  timeZone: "UTC",
  ...options,
});

const shortMonthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Data local inválida: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Data local inválida: ${value}`);
  }
  return date;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(dateKey: string, amount: number) {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  return toDateKey(date);
}

function addCalendarMonths(dateKey: string, amount: number) {
  const date = parseDateKey(dateKey);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return toDateKey(date);
}

function startOfIsoWeek(dateKey: string) {
  const date = parseDateKey(dateKey);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addCalendarDays(dateKey, -daysSinceMonday);
}

function startOfCalendarMonth(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

function startOfGrain(dateKey: string, grain: MeetingMetricGrain) {
  if (grain === "week") return startOfIsoWeek(dateKey);
  if (grain === "month") return startOfCalendarMonth(dateKey);
  return dateKey;
}

function nextBucketStart(dateKey: string, grain: MeetingMetricGrain) {
  if (grain === "week") return addCalendarDays(dateKey, 7);
  if (grain === "month") return addCalendarMonths(dateKey, 1);
  return addCalendarDays(dateKey, 1);
}

function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

/** Converts a local midnight to its real UTC instant without assuming a fixed Lisbon offset. */
function localMidnightToIso(dateKey: string, timeZone: string) {
  const local = parseDateKey(dateKey);
  const wanted = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let candidate = wanted;

  // Two passes handle an offset change between the initial UTC guess and local midnight.
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const correction = wanted - representedAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }

  return new Date(candidate).toISOString();
}

export function meetingLocalDate(now: Date = new Date(), timeZone = MEETING_METRICS_TIME_ZONE) {
  const parts = zonedParts(now, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function dateKeyFromInput(value: string | Date, timeZone: string) {
  if (value instanceof Date) return meetingLocalDate(value, timeZone);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parseDateKey(value);
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Data inválida: ${value}`);
  return meetingLocalDate(parsed, timeZone);
}

function formatDateRange(fromDate: string, toDateExclusive: string) {
  const throughDate = addCalendarDays(toDateExclusive, -1);
  const from = parseDateKey(fromDate);
  const through = parseDateKey(throughDate);
  const formatter = dateFormatter({ day: "numeric", month: "short", year: "numeric" });
  if (fromDate === throughDate) return formatter.format(from);
  return `${formatter.format(from)} – ${formatter.format(through)}`;
}

export function buildMeetingMetricsInterval(
  preset: MeetingMetricsPreset,
  options: {
    now?: Date;
    timeZone?: string;
    historyStart?: string | Date;
    customFrom?: string;
    customToExclusive?: string;
  } = {},
): MeetingMetricsInterval {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? MEETING_METRICS_TIME_ZONE;
  const today = meetingLocalDate(now, timeZone);
  let fromDate: string;
  let toDateExclusive: string;

  if (preset === "30d") {
    fromDate = addCalendarDays(today, -29);
    toDateExclusive = addCalendarDays(today, 1);
  } else if (preset === "12w") {
    fromDate = addCalendarDays(startOfIsoWeek(today), -11 * 7);
    toDateExclusive = addCalendarDays(startOfIsoWeek(today), 7);
  } else if (preset === "12m") {
    fromDate = addCalendarMonths(startOfCalendarMonth(today), -11);
    toDateExclusive = addCalendarMonths(startOfCalendarMonth(today), 1);
  } else if (preset === "all") {
    if (!options.historyStart) throw new Error("Todo o histórico requer a data do primeiro evento.");
    fromDate = dateKeyFromInput(options.historyStart, timeZone);
    toDateExclusive = addCalendarDays(today, 1);
  } else {
    if (!options.customFrom || !options.customToExclusive) {
      throw new Error("O intervalo personalizado requer início e fim exclusivo.");
    }
    fromDate = dateKeyFromInput(options.customFrom, timeZone);
    toDateExclusive = dateKeyFromInput(options.customToExclusive, timeZone);
  }

  if (fromDate >= toDateExclusive) throw new Error("O fim do intervalo deve ser posterior ao início.");

  return {
    preset,
    timeZone,
    from: localMidnightToIso(fromDate, timeZone),
    to: localMidnightToIso(toDateExclusive, timeZone),
    fromDate,
    toDateExclusive,
    label: formatDateRange(fromDate, toDateExclusive),
  };
}

export function previousMeetingMetricsInterval(interval: MeetingMetricsInterval): MeetingMetricsInterval {
  const dayMs = 86_400_000;
  const durationDays = Math.round((parseDateKey(interval.toDateExclusive).getTime() - parseDateKey(interval.fromDate).getTime()) / dayMs);
  const toDateExclusive = interval.fromDate;
  const fromDate = addCalendarDays(toDateExclusive, -durationDays);
  return {
    ...interval,
    preset: "custom",
    fromDate,
    toDateExclusive,
    from: localMidnightToIso(fromDate, interval.timeZone),
    to: localMidnightToIso(toDateExclusive, interval.timeZone),
    label: formatDateRange(fromDate, toDateExclusive),
  };
}

function count(value: RpcCount | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function bucketDateKey(value: string) {
  const key = value.slice(0, 10);
  parseDateKey(key);
  return key;
}

export function normalizeMeetingMetricRows(rows: readonly MeetingMetricBucketRpc[]): MeetingMetricBucket[] {
  return rows.map((row) => ({
    bucketStart: bucketDateKey(row.bucket_start),
    meetingCount: count(row.meeting_count),
    participationCount: count(row.participation_count),
    scheduledCount: count(row.scheduled_count),
    heldCount: count(row.held_count),
    cancelledCount: count(row.cancelled_count),
    noShowCount: count(row.no_show_count),
    unknownCount: count(row.unknown_count),
    tentativeCount: count(row.tentative_count),
  })).sort((left, right) => left.bucketStart.localeCompare(right.bucketStart));
}

const emptyBucket = (bucketStart: string): MeetingMetricBucket => ({
  bucketStart,
  meetingCount: 0,
  participationCount: 0,
  scheduledCount: 0,
  heldCount: 0,
  cancelledCount: 0,
  noShowCount: 0,
  unknownCount: 0,
  tentativeCount: 0,
});

/** Makes zero periods explicit, including leading and trailing periods in the requested interval. */
export function fillMeetingMetricBuckets(
  rows: readonly MeetingMetricBucket[],
  grain: MeetingMetricGrain,
  interval: MeetingMetricsInterval,
) {
  const byStart = new Map(rows.map((row) => [row.bucketStart, row]));
  const result: MeetingMetricBucket[] = [];
  let cursor = startOfGrain(interval.fromDate, grain);
  while (cursor < interval.toDateExclusive) {
    result.push(byStart.get(cursor) ?? emptyBucket(cursor));
    cursor = nextBucketStart(cursor, grain);
  }
  return result;
}

export function isCurrentMeetingBucket(
  bucketStart: string,
  grain: MeetingMetricGrain,
  now: Date = new Date(),
  timeZone = MEETING_METRICS_TIME_ZONE,
) {
  return startOfGrain(meetingLocalDate(now, timeZone), grain) === bucketDateKey(bucketStart);
}

export function isMeetingBucketPartial(
  bucketStart: string,
  grain: MeetingMetricGrain,
  options: { now?: Date; timeZone?: string; interval?: MeetingMetricsInterval } = {},
) {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? options.interval?.timeZone ?? MEETING_METRICS_TIME_ZONE;
  const start = bucketDateKey(bucketStart);
  const end = nextBucketStart(start, grain);
  const intervalCutsBucket = options.interval
    ? options.interval.fromDate > start || options.interval.toDateExclusive < end
    : false;
  const endInstant = new Date(localMidnightToIso(end, timeZone));
  return intervalCutsBucket || endInstant.getTime() > now.getTime();
}

function shortDate(dateKey: string) {
  const date = parseDateKey(dateKey);
  return `${date.getUTCDate()} ${shortMonthNames[date.getUTCMonth()]}`;
}

export function formatMeetingBucketLabel(bucketStart: string, grain: MeetingMetricGrain) {
  const start = bucketDateKey(bucketStart);
  if (grain === "day") return shortDate(start);
  if (grain === "month") {
    const date = parseDateKey(start);
    return `${shortMonthNames[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }

  const end = addCalendarDays(start, 6);
  const startDate = parseDateKey(start);
  const endDate = parseDateKey(end);
  const startYear = startDate.getUTCFullYear();
  const endYear = endDate.getUTCFullYear();
  const startMonth = startDate.getUTCMonth();
  const endMonth = endDate.getUTCMonth();
  if (startYear !== endYear) {
    return `${shortDate(start)} ${startYear} – ${shortDate(end)} ${endYear}`;
  }
  if (startMonth !== endMonth) return `${shortDate(start)} – ${shortDate(end)}`;
  const month = shortMonthNames[startMonth];
  return `${startDate.getUTCDate()}–${endDate.getUTCDate()} ${month}`;
}

export function formatMeetingChartRows(
  rows: readonly MeetingMetricBucket[],
  grain: MeetingMetricGrain,
  options: { now?: Date; timeZone?: string; interval?: MeetingMetricsInterval } = {},
): MeetingChartRow[] {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? options.interval?.timeZone ?? MEETING_METRICS_TIME_ZONE;
  return rows.map((row) => ({
    ...row,
    label: formatMeetingBucketLabel(row.bucketStart, grain),
    isPartial: isMeetingBucketPartial(row.bucketStart, grain, { ...options, now, timeZone }),
    isCurrentPartial: isCurrentMeetingBucket(row.bucketStart, grain, now, timeZone),
  }));
}

function sumRows(rows: readonly MeetingMetricBucket[]): MeetingMetricTotals {
  return rows.reduce<MeetingMetricTotals>((total, row) => ({
    meetings: total.meetings + row.meetingCount,
    participations: total.participations + row.participationCount,
    scheduled: total.scheduled + row.scheduledCount,
    held: total.held + row.heldCount,
    cancelled: total.cancelled + row.cancelledCount,
    noShow: total.noShow + row.noShowCount,
    unknown: total.unknown + row.unknownCount,
    tentative: total.tentative + row.tentativeCount,
  }), { meetings: 0, participations: 0, scheduled: 0, held: 0, cancelled: 0, noShow: 0, unknown: 0, tentative: 0 });
}

function averageForGrain(
  rows: readonly MeetingMetricBucket[],
  grain: MeetingMetricGrain,
  options: { now: Date; timeZone: string; interval?: MeetingMetricsInterval },
) {
  const completed = rows.filter((row) => !isMeetingBucketPartial(row.bucketStart, grain, options));
  if (!completed.length) return { average: null, completed: 0 };
  return {
    average: completed.reduce((sum, row) => sum + row.meetingCount, 0) / completed.length,
    completed: completed.length,
  };
}

export function buildMeetingSummary({
  dayRows,
  weekRows,
  monthRows,
  now = new Date(),
  timeZone = MEETING_METRICS_TIME_ZONE,
  interval,
}: {
  dayRows: readonly MeetingMetricBucket[];
  weekRows: readonly MeetingMetricBucket[];
  monthRows: readonly MeetingMetricBucket[];
  now?: Date;
  timeZone?: string;
  interval?: MeetingMetricsInterval;
}): MeetingSummary {
  const options = { now, timeZone, interval };
  const daily = averageForGrain(dayRows, "day", options);
  const weekly = averageForGrain(weekRows, "week", options);
  const monthly = averageForGrain(monthRows, "month", options);
  const totalSource = dayRows.length ? dayRows : weekRows.length ? weekRows : monthRows;
  const totals = sumRows(totalSource);

  return {
    totalMeetings: totals.meetings,
    totalParticipations: totals.participations,
    totals,
    averages: { day: daily.average, week: weekly.average, month: monthly.average },
    completedBuckets: { day: daily.completed, week: weekly.completed, month: monthly.completed },
    hasCurrentPartial: {
      day: dayRows.some((row) => isCurrentMeetingBucket(row.bucketStart, "day", now, timeZone)),
      week: weekRows.some((row) => isCurrentMeetingBucket(row.bucketStart, "week", now, timeZone)),
      month: monthRows.some((row) => isCurrentMeetingBucket(row.bucketStart, "month", now, timeZone)),
    },
  };
}

export function compareMeetingPeriods(current: number, previous: number): MeetingPeriodComparison {
  const absoluteChange = current - previous;
  return {
    current,
    previous,
    absoluteChange,
    percentageChange: previous === 0 ? null : (absoluteChange / previous) * 100,
    direction: absoluteChange > 0 ? "up" : absoluteChange < 0 ? "down" : "flat",
  };
}

export function combineMeetingMetrics({
  dayRows,
  weekRows,
  monthRows,
  interval,
  now = new Date(),
}: {
  dayRows: readonly MeetingMetricBucketRpc[];
  weekRows: readonly MeetingMetricBucketRpc[];
  monthRows: readonly MeetingMetricBucketRpc[];
  interval: MeetingMetricsInterval;
  now?: Date;
}) {
  const normalized = {
    day: fillMeetingMetricBuckets(normalizeMeetingMetricRows(dayRows), "day", interval),
    week: fillMeetingMetricBuckets(normalizeMeetingMetricRows(weekRows), "week", interval),
    month: fillMeetingMetricBuckets(normalizeMeetingMetricRows(monthRows), "month", interval),
  };
  return {
    rows: normalized,
    chartRows: {
      day: formatMeetingChartRows(normalized.day, "day", { interval, now }),
      week: formatMeetingChartRows(normalized.week, "week", { interval, now }),
      month: formatMeetingChartRows(normalized.month, "month", { interval, now }),
    },
    summary: buildMeetingSummary({
      dayRows: normalized.day,
      weekRows: normalized.week,
      monthRows: normalized.month,
      interval,
      now,
      timeZone: interval.timeZone,
    }),
  };
}

export function meetingCountLabel(value: number) {
  return `${new Intl.NumberFormat("pt-PT").format(value)} ${value === 1 ? "reunião" : "reuniões"}`;
}

export function formatMeetingAverage(value: number | null, grain: MeetingMetricGrain) {
  if (value === null) return "Sem período completo";
  const formatted = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 }).format(value);
  const unit = grain === "day" ? "dia" : grain === "week" ? "semana" : "mês";
  return `${formatted} ${value === 1 ? "reunião" : "reuniões"} por ${unit}`;
}
