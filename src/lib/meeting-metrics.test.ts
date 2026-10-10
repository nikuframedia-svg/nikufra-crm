import { describe, expect, it } from "vitest";
import {
  buildMeetingMetricsInterval,
  buildMeetingSummary,
  combineMeetingMetrics,
  compareMeetingPeriods,
  fillMeetingMetricBuckets,
  formatMeetingAverage,
  formatMeetingBucketLabel,
  isCurrentMeetingBucket,
  isMeetingBucketPartial,
  meetingCountLabel,
  meetingLocalDate,
  normalizeMeetingMetricRows,
  previousMeetingMetricsInterval,
} from "./meeting-metrics";
import type { MeetingMetricBucket, MeetingMetricBucketRpc } from "./meeting-metrics";

const bucket = (bucketStart: string, meetingCount: number): MeetingMetricBucket => ({
  bucketStart,
  meetingCount,
  participationCount: meetingCount,
  scheduledCount: 0,
  heldCount: meetingCount,
  cancelledCount: 0,
  noShowCount: 0,
  unknownCount: 0,
  tentativeCount: 0,
});

const rpcBucket = (bucketStart: string, meetingCount: number | string): MeetingMetricBucketRpc => ({
  bucket_start: bucketStart,
  meeting_count: meetingCount,
  participation_count: meetingCount,
  scheduled_count: "0",
  held_count: meetingCount,
  cancelled_count: "0",
  no_show_count: "0",
  unknown_count: "0",
  tentative_count: "0",
});

describe("intervalos das métricas de reuniões", () => {
  it("cria 30 dias civis com limites [from, to) corretos durante a mudança para hora de verão", () => {
    const interval = buildMeetingMetricsInterval("30d", { now: new Date("2026-03-29T12:00:00.000Z") });

    expect(interval.fromDate).toBe("2026-02-28");
    expect(interval.toDateExclusive).toBe("2026-03-30");
    expect(interval.from).toBe("2026-02-28T00:00:00.000Z");
    expect(interval.to).toBe("2026-03-29T23:00:00.000Z");
    expect((new Date(interval.to).getTime() - new Date(interval.from).getTime()) / 3_600_000).toBe(719);
  });

  it("alinha as 12 semanas pela segunda-feira ISO mesmo na virada do ano", () => {
    const interval = buildMeetingMetricsInterval("12w", { now: new Date("2027-01-01T12:00:00.000Z") });

    expect(interval.fromDate).toBe("2026-10-12");
    expect(interval.toDateExclusive).toBe("2027-01-04");
  });

  it("interpreta instantes no dia local de Lisboa", () => {
    expect(meetingLocalDate(new Date("2026-07-01T23:30:00.000Z"))).toBe("2026-07-02");
    expect(meetingLocalDate(new Date("2026-12-31T23:30:00.000Z"))).toBe("2026-12-31");
  });

  it("cria o período anterior com a mesma quantidade de dias civis", () => {
    const current = buildMeetingMetricsInterval("custom", {
      customFrom: "2026-03-01",
      customToExclusive: "2026-04-01",
    });
    const previous = previousMeetingMetricsInterval(current);

    expect(previous.fromDate).toBe("2026-01-29");
    expect(previous.toDateExclusive).toBe("2026-03-01");
    expect(previous.to).toBe(current.from);
  });

  it("exige limites válidos para histórico e intervalos personalizados", () => {
    expect(() => buildMeetingMetricsInterval("all")).toThrow(/primeiro evento/i);
    expect(() => buildMeetingMetricsInterval("custom", {
      customFrom: "2026-10-10",
      customToExclusive: "2026-10-10",
    })).toThrow(/posterior/i);
  });
});

describe("normalização e buckets vazios", () => {
  it("normaliza bigint do Postgres e ordena cronologicamente", () => {
    const rows = normalizeMeetingMetricRows([
      rpcBucket("2026-10-03", "3"),
      { ...rpcBucket("2026-10-01", 1), participation_count: "4" },
    ]);

    expect(rows.map((row) => row.bucketStart)).toEqual(["2026-10-01", "2026-10-03"]);
    expect(rows[0]).toMatchObject({ meetingCount: 1, participationCount: 4 });
    expect(rows[1]).toMatchObject({ meetingCount: 3, heldCount: 3 });
  });

  it("preenche zeros no início, no meio e no fim do intervalo", () => {
    const interval = buildMeetingMetricsInterval("custom", {
      customFrom: "2026-10-01",
      customToExclusive: "2026-10-05",
    });
    const rows = fillMeetingMetricBuckets([bucket("2026-10-02", 2)], "day", interval);

    expect(rows.map((row) => [row.bucketStart, row.meetingCount])).toEqual([
      ["2026-10-01", 0],
      ["2026-10-02", 2],
      ["2026-10-03", 0],
      ["2026-10-04", 0],
    ]);
  });
});

describe("resumo e períodos parciais", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");

  it("inclui buckets zero e exclui o bucket atual incompleto das médias", () => {
    const summary = buildMeetingSummary({
      dayRows: [bucket("2026-10-12", 2), bucket("2026-10-13", 0), bucket("2026-10-14", 10)],
      weekRows: [bucket("2026-10-05", 4), bucket("2026-10-12", 10)],
      monthRows: [bucket("2026-09-01", 8), bucket("2026-10-01", 10)],
      now,
    });

    expect(summary.totalMeetings).toBe(12);
    expect(summary.averages).toEqual({ day: 1, week: 4, month: 8 });
    expect(summary.completedBuckets).toEqual({ day: 2, week: 1, month: 1 });
    expect(summary.hasCurrentPartial).toEqual({ day: true, week: true, month: true });
  });

  it("devolve null quando ainda não existe um período completo", () => {
    const summary = buildMeetingSummary({
      dayRows: [bucket("2026-10-14", 2)],
      weekRows: [bucket("2026-10-12", 2)],
      monthRows: [bucket("2026-10-01", 2)],
      now,
    });

    expect(summary.averages).toEqual({ day: null, week: null, month: null });
  });

  it("marca como parcial um bucket cortado pelo intervalo personalizado", () => {
    const interval = buildMeetingMetricsInterval("custom", {
      customFrom: "2026-10-07",
      customToExclusive: "2026-10-10",
    });

    expect(isMeetingBucketPartial("2026-10-05", "week", { interval, now: new Date("2026-11-01T12:00:00Z") })).toBe(true);
    expect(isCurrentMeetingBucket("2026-10-12", "week", now)).toBe(true);
  });
});

describe("comparação, labels e combinação", () => {
  it("não inventa uma percentagem quando o período anterior é zero", () => {
    expect(compareMeetingPeriods(5, 0)).toEqual({
      current: 5,
      previous: 0,
      absoluteChange: 5,
      percentageChange: null,
      direction: "up",
    });
    expect(compareMeetingPeriods(6, 4).percentageChange).toBe(50);
  });

  it("formata labels portuguesas, pluralização e semanas que atravessam anos", () => {
    expect(formatMeetingBucketLabel("2026-10-09", "day")).toBe("9 out");
    expect(formatMeetingBucketLabel("2026-10-01", "month")).toBe("out 2026");
    expect(formatMeetingBucketLabel("2026-12-28", "week")).toContain("2027");
    expect(meetingCountLabel(1)).toBe("1 reunião");
    expect(meetingCountLabel(2)).toBe("2 reuniões");
    expect(formatMeetingAverage(1, "week")).toBe("1 reunião por semana");
    expect(formatMeetingAverage(1.5, "month")).toBe("1,5 reuniões por mês");
    expect(formatMeetingAverage(null, "day")).toBe("Sem período completo");
  });

  it("combina os três grains, preenche zeros e produz linhas prontas para o gráfico", () => {
    const interval = buildMeetingMetricsInterval("custom", {
      customFrom: "2026-10-01",
      customToExclusive: "2026-10-04",
    });
    const combined = combineMeetingMetrics({
      dayRows: [rpcBucket("2026-10-02", "2")],
      weekRows: [rpcBucket("2026-09-28", "2")],
      monthRows: [rpcBucket("2026-10-01", "2")],
      interval,
      now: new Date("2026-11-01T12:00:00.000Z"),
    });

    expect(combined.rows.day.map((row) => row.meetingCount)).toEqual([0, 2, 0]);
    expect(combined.chartRows.day[1]).toMatchObject({ label: "2 out", meetingCount: 2, isPartial: false });
    expect(combined.summary.totalMeetings).toBe(2);
    expect(combined.summary.averages.day).toBeCloseTo(2 / 3);
    expect(combined.summary.averages.week).toBeNull();
    expect(combined.summary.averages.month).toBeNull();
  });
});
