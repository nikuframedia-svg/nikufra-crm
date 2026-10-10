import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock, CalendarRange, ChevronDown, CircleAlert, Users } from "lucide-react";
import {
  buildMeetingMetricsInterval,
  combineMeetingMetrics,
  compareMeetingPeriods,
  fillMeetingMetricBuckets,
  meetingCountLabel,
  meetingGrainLabels,
  meetingKindLabels,
  meetingLocalDate,
  MEETING_METRICS_PRESETS,
  normalizeMeetingMetricRows,
  previousMeetingMetricsInterval,
  type MeetingChartRow,
  type MeetingMetricBucketRpc,
  type MeetingMetricGrain,
  type MeetingMetricKind,
  type MeetingMetricsInterval,
  type MeetingMetricsPreset,
} from "../lib/meeting-metrics";
import { formatDecimal, formatPercentage } from "../lib/format";
import { supabase } from "../lib/supabase";
import { useCRM } from "../state/crm-context";
import { Card, EmptyState } from "./ui";

const grains: MeetingMetricGrain[] = ["day", "week", "month"];

function shiftDate(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function comparisonLabel(percentage: number | null, previous: number) {
  if (percentage === null) return previous === 0 ? "Sem comparação anterior" : "Sem comparação";
  const prefix = percentage > 0 ? "+" : "";
  return `${prefix}${formatPercentage(percentage)} vs. período anterior`;
}

function completedPeriodsLabel(count: number, grain: MeetingMetricGrain) {
  if (!count) return "sem período completo";
  const noun = grain === "day" ? (count === 1 ? "dia completo" : "dias completos")
    : grain === "week" ? (count === 1 ? "semana completa" : "semanas completas")
      : count === 1 ? "mês completo" : "meses completos";
  return `${count} ${noun}`;
}

function MeetingChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: MeetingChartRow }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="meeting-chart-tooltip">
      <strong>{row.label}{row.isPartial ? " · parcial" : ""}</strong>
      <span><b>{row.meetingCount}</b>{row.meetingCount === 1 ? " reunião" : " reuniões"}</span>
      <span><b>{row.participationCount}</b>{row.participationCount === 1 ? " participação" : " participações"}</span>
      {row.heldCount || row.scheduledCount || row.unknownCount ? <small>{row.heldCount} realizadas · {row.scheduledCount} agendadas · {row.unknownCount} sem resultado</small> : null}
    </div>
  );
}

async function loadMeetingMetricRows(
  interval: MeetingMetricsInterval,
  grain: MeetingMetricGrain,
  ownerId: string,
  kind: MeetingMetricKind,
) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("meeting_metrics", {
    p_from: interval.from,
    p_to: interval.to,
    p_grain: grain,
    p_user_id: ownerId === "all" ? null : ownerId,
    p_kind: kind,
    p_timezone: interval.timeZone,
  });
  if (error) throw error;
  return (data ?? []) as MeetingMetricBucketRpc[];
}

export function MeetingMetricsPanel() {
  const { team } = useCRM();
  const today = useMemo(() => meetingLocalDate(), []);
  const [preset, setPreset] = useState<MeetingMetricsPreset>("12w");
  const [grain, setGrain] = useState<MeetingMetricGrain>("week");
  const [kind, setKind] = useState<MeetingMetricKind>("external");
  const [ownerId, setOwnerId] = useState("all");
  const [customFrom, setCustomFrom] = useState(() => shiftDate(today, -89));
  const [customTo, setCustomTo] = useState(today);

  const { data: historyStart, isLoading: isLoadingHistory, error: historyError } = useQuery({
    queryKey: ["meeting-metrics-history-start", ownerId],
    enabled: Boolean(supabase),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let query = supabase!.from("google_calendar_events").select("inicio").order("inicio", { ascending: true }).limit(1);
      if (ownerId !== "all") query = query.eq("user_id", ownerId);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data?.inicio ?? null;
    },
  });

  const intervalResult = useMemo(() => {
    try {
      if (preset === "all" && !historyStart) return { interval: null, error: null };
      const interval = buildMeetingMetricsInterval(preset, {
        historyStart: historyStart ?? undefined,
        customFrom,
        customToExclusive: shiftDate(customTo, 1),
      });
      return { interval, error: null };
    } catch (error) {
      return { interval: null, error: error instanceof Error ? error.message : "Intervalo inválido." };
    }
  }, [customFrom, customTo, historyStart, preset]);

  const interval = intervalResult.interval;
  const metricsQuery = useQuery({
    queryKey: ["meeting-metrics", interval?.from, interval?.to, ownerId, kind, grain],
    enabled: Boolean(supabase && interval),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      if (!interval) throw new Error("Intervalo indisponível.");
      const previous = previousMeetingMetricsInterval(interval);
      const [dayRows, weekRows, monthRows, previousRows] = await Promise.all([
        loadMeetingMetricRows(interval, "day", ownerId, kind),
        loadMeetingMetricRows(interval, "week", ownerId, kind),
        loadMeetingMetricRows(interval, "month", ownerId, kind),
        loadMeetingMetricRows(previous, grain, ownerId, kind),
      ]);
      const combined = combineMeetingMetrics({ dayRows, weekRows, monthRows, interval });
      const normalizedPrevious = fillMeetingMetricBuckets(normalizeMeetingMetricRows(previousRows), grain, previous);
      const previousTotal = normalizedPrevious.reduce((sum, row) => sum + row.meetingCount, 0);
      return {
        ...combined,
        comparison: compareMeetingPeriods(combined.summary.totalMeetings, previousTotal),
      };
    },
  });

  const data = metricsQuery.data;
  const chartRows = data?.chartRows[grain] ?? [];
  const selectedAverage = data?.summary.averages[grain] ?? null;
  const outcomeDenominator = (data?.summary.totals.held ?? 0) + (data?.summary.totals.noShow ?? 0);
  const noShowRate = outcomeDenominator ? 100 * (data?.summary.totals.noShow ?? 0) / outcomeDenominator : null;
  const originallyScheduled = (data?.summary.totalMeetings ?? 0) + (data?.summary.totals.cancelled ?? 0) + (data?.summary.totals.noShow ?? 0);
  const cancellationRate = originallyScheduled ? 100 * (data?.summary.totals.cancelled ?? 0) / originallyScheduled : null;
  const selectedOwner = ownerId === "all" ? "Toda a equipa" : team.find((member) => member.id === ownerId)?.nome ?? "Pessoa";
  const isLoading = metricsQuery.isLoading || (preset === "all" && isLoadingHistory);
  const isEmpty = !isLoading && !metricsQuery.error && data?.summary.totalMeetings === 0 && data.summary.totals.cancelled === 0;

  return (
    <Card className="meeting-analytics" aria-labelledby="meeting-analytics-title">
      <header className="meeting-analytics__header">
        <div>
          <span className="meeting-analytics__source"><CalendarClock size={15} />Google Calendar principal</span>
          <h2 id="meeting-analytics-title">Evolução de reuniões</h2>
          <p>Ocorrências únicas do calendário, sem duplicar o mesmo convite entre membros. Por defeito, mostra reuniões com participantes externos.</p>
        </div>
        {interval ? <span className="meeting-analytics__period">{interval.label}</span> : null}
      </header>

      <div className="meeting-analytics__controls" aria-label="Filtros das métricas de reuniões">
        <label className="meeting-filter">
          <span>Intervalo</span>
          <span className="meeting-filter__select"><CalendarRange size={15} /><select value={preset} onChange={(event) => setPreset(event.target.value as MeetingMetricsPreset)}>{MEETING_METRICS_PRESETS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={14} /></span>
        </label>
        <fieldset className="meeting-filter meeting-filter--grain">
          <legend>Agrupar por</legend>
          <div className="meeting-segmented">{grains.map((option) => <button type="button" key={option} className={grain === option ? "is-active" : ""} aria-pressed={grain === option} onClick={() => setGrain(option)}>{meetingGrainLabels[option]}</button>)}</div>
        </fieldset>
        <label className="meeting-filter">
          <span>Tipo</span>
          <span className="meeting-filter__select"><select value={kind} onChange={(event) => setKind(event.target.value as MeetingMetricKind)}>{Object.entries(meetingKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={14} /></span>
        </label>
        <label className="meeting-filter">
          <span>Pessoa</span>
          <span className="meeting-filter__select"><Users size={15} /><select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="all">Toda a equipa</option>{team.map((member) => <option value={member.id} key={member.id}>{member.nome}</option>)}</select><ChevronDown size={14} /></span>
        </label>
        {preset === "custom" ? <div className="meeting-custom-range"><label><span>Desde</span><input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label><span>Até</span><input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div> : null}
      </div>

      {intervalResult.error ? <div className="meeting-analytics__error"><CircleAlert size={16} />{intervalResult.error}</div> : null}
      {historyError ? <div className="meeting-analytics__error"><CircleAlert size={16} />Não foi possível determinar o início do histórico do calendário.</div> : null}
      {metricsQuery.error ? <div className="meeting-analytics__error"><CircleAlert size={16} /><span><strong>Não foi possível calcular as reuniões.</strong> A agenda e as restantes métricas continuam disponíveis.</span></div> : null}

      {isLoading ? <div className="meeting-analytics__loading" aria-label="A carregar métricas de reuniões"><i /><i /><i /><i /><span /></div> : null}
      {!isLoading && data ? <>
        <div className="meeting-summary" aria-label="Resumo de reuniões">
          <div className="meeting-summary__primary">
            <span>Total no período</span>
            <strong className="mono">{meetingCountLabel(data.summary.totalMeetings)}</strong>
            <small className={data.comparison.direction === "down" ? "negative" : data.comparison.direction === "up" ? "positive" : ""}>{comparisonLabel(data.comparison.percentageChange, data.comparison.previous)}</small>
          </div>
          {grains.map((item) => <div key={item}><span>Média por {item === "day" ? "dia" : item === "week" ? "semana" : "mês"}</span><strong className="mono">{data.summary.averages[item] === null ? "—" : formatDecimal(data.summary.averages[item]!)}</strong><small>{completedPeriodsLabel(data.summary.completedBuckets[item], item)}</small></div>)}
        </div>

        <div className="meeting-chart-panel">
          <div className="meeting-chart-panel__meta">
            <div><strong>{meetingGrainLabels[grain]} a {meetingGrainLabels[grain].toLowerCase()}</strong><span>{meetingKindLabels[kind]} · {selectedOwner}</span></div>
            <div className="meeting-chart-legend"><span><i />Reuniões</span><span><i className="is-average" />Média dos períodos completos</span></div>
          </div>
          {isEmpty ? <EmptyState>Não existem reuniões deste tipo no intervalo escolhido. Altera o tipo, a pessoa ou o período.</EmptyState> : <div className="meeting-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 18, right: 12, left: -16, bottom: 2 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={24} tick={{ fill: "var(--muted)", fontSize: 10 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={38} tick={{ fill: "var(--muted)", fontSize: 10 }} />
                <Tooltip cursor={{ fill: "var(--surface-soft)" }} content={<MeetingChartTooltip />} />
                {selectedAverage !== null ? <ReferenceLine y={selectedAverage} stroke="var(--muted)" strokeDasharray="5 4" /> : null}
                <Bar dataKey="meetingCount" name="Reuniões" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={42}>
                  {chartRows.map((row) => <Cell key={row.bucketStart} fillOpacity={row.isPartial ? 0.48 : 0.9} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>}
          <p className="meeting-chart-note"><CircleAlert size={14} />O período atual aparece com transparência e não entra na média. Um evento passado só conta como “realizado” depois de o resultado ser confirmado.</p>
        </div>

        <div className="meeting-outcomes" aria-label="Resultados classificados">
          <span><b className="mono">{data.summary.totals.held}</b> realizadas</span>
          <span><b className="mono">{data.summary.totals.scheduled}</b> agendadas</span>
          <span><b className="mono">{data.summary.totals.unknown}</b> sem resultado</span>
          <span><b className="mono">{data.summary.totals.cancelled}</b> canceladas{cancellationRate === null ? "" : ` · ${formatPercentage(cancellationRate)}`}</span>
          <span><b className="mono">{data.summary.totals.noShow}</b> no-show{noShowRate === null ? " · sem amostra classificada" : ` · ${formatPercentage(noShowRate)}`}</span>
          <span><b className="mono">{data.summary.totalParticipations}</b> participações</span>
        </div>
      </> : null}

      {!isLoading && preset === "all" && !historyStart && !historyError ? <EmptyState>Ainda não existem eventos sincronizados no Google Calendar.</EmptyState> : null}

      {!supabase ? <div className="meeting-analytics__error"><CircleAlert size={16} />Estas métricas requerem o servidor e o Google Calendar ligados.</div> : null}
    </Card>
  );
}
