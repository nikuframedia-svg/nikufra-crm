import { BarChart3, CalendarRange, ChevronDown, CircleGauge, Clock3, Target, TrendingUp, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { stageLabels, stageOrder } from "../data/seed";
import { formatCurrency, formatDecimal, formatPercentage } from "../lib/format";
import { useRevenueData } from "../hooks/use-revenue-data";
import { supabase } from "../lib/supabase";
import { useCRM } from "../state/crm-context";
import { Card, MetricCard, PageHeader, SampleBadge } from "../components/ui";

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function MetricsPage() {
  const { opportunities, leads, activities } = useCRM();
  const { entries: revenueEntries } = useRevenueData();
  const weighted = opportunities.reduce((sum, item) => sum + item.valor * item.probabilidade / 100, 0);
  const { data: serverMetrics } = useQuery({
    queryKey: ["crm-metrics"],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const [cohorts, noShow, cycle, pipeline, results, funnel, time, verticals, clients] = await Promise.all([
        supabase!.from("metricas_taxa_reuniao_coorte").select("*"), supabase!.from("metricas_no_show").select("*"), supabase!.from("metricas_ciclo_acordo_verbal").select("*"), supabase!.from("metricas_pipeline").select("*"), supabase!.from("metricas_resultados").select("*"), supabase!.from("metricas_funil").select("*").order("ordem"), supabase!.from("metricas_tempo_estado").select("*"), supabase!.from("metricas_distribuicao_vertical").select("*"), supabase!.from("metricas_cliente").select("*").order("faturacao_acumulada", { ascending: false }),
      ]);
      const firstError = [cohorts, noShow, cycle, pipeline, results, funnel, time, verticals, clients].find((result) => result.error)?.error;
      if (firstError) throw firstError;
      return { cohorts: cohorts.data ?? [], noShow: noShow.data?.[0], cycle: cycle.data?.[0], pipeline: pipeline.data?.[0], results: results.data?.[0], funnel: funnel.data ?? [], time: time.data ?? [], verticals: verticals.data ?? [], clients: clients.data ?? [] };
    },
  });

  const stageRank = new Map(stageOrder.map((stage, index) => [stage, index]));
  const contacted = opportunities.filter((item) => (stageRank.get(item.estado) ?? -1) >= 1);
  const met = opportunities.filter((item) => (stageRank.get(item.estado) ?? -1) >= 2);
  const contactedLeads = leads.filter((lead) => (stageRank.get(lead.estado) ?? -1) >= 1);
  const metLeads = leads.filter((lead) => (stageRank.get(lead.estado) ?? -1) >= 2);
  const clients = opportunities.filter((item) => item.estado === "cliente");
  const cohortTotals = serverMetrics?.cohorts.reduce((acc, row) => ({ contacted: acc.contacted + Number(row.n_contactadas), meetings: acc.meetings + Number(row.n_reunioes) }), { contacted: 0, meetings: 0 });
  const hasCohortSample = Boolean(cohortTotals?.contacted);
  const meetingDenominator = hasCohortSample ? cohortTotals!.contacted : serverMetrics ? contacted.length : contactedLeads.length;
  const meetingNumerator = hasCohortSample ? cohortTotals!.meetings : serverMetrics ? met.length : metLeads.length;
  const meetingRate = meetingDenominator ? 100 * meetingNumerator / meetingDenominator : null;
  const localCycleMonths = opportunities.map((item) => item.cicloAcordoMeses).filter((value): value is number => value != null && value >= 0);
  const localCycleMedian = median(localCycleMonths);
  const localCycleAverage = localCycleMonths.length ? localCycleMonths.reduce((sum, value) => sum + value, 0) / localCycleMonths.length : null;

  const localTime = stageOrder.slice(0, -1).map((stage) => {
    const values = opportunities.filter((item) => item.estado === stage).map((item) => item.diasNoEstado);
    return { etapa: stageLabels[stage], mediana: median(values) ?? 0, media: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0, ativos: values.length };
  }).filter((item) => item.ativos);
  const verticalByCompany = new Map(leads.map((lead) => [lead.empresaId ?? lead.empresa.toLowerCase(), lead.vertical]));
  const localDistribution = [...opportunities.reduce((map, item) => {
    const vertical = verticalByCompany.get(item.empresaId ?? item.empresa.toLowerCase()) ?? "Outro";
    const current = map.get(vertical) ?? { vertical, total: 0, valor: 0 };
    current.total += 1; current.valor += item.valor; map.set(vertical, current); return map;
  }, new Map<string, { vertical: string; total: number; valor: number }>()).values()].sort((a, b) => b.valor - a.valor || b.total - a.total);
  const localClients = clients.map((client) => ({
    empresa_id: client.empresaId ?? client.id,
    nome: client.empresa,
    faturacao_acumulada: revenueEntries.filter((entry) => entry.empresaId === client.empresaId && entry.tipo === "Faturado").reduce((sum, entry) => sum + entry.valor, 0),
    meses_ativo: client.dataFecho ? Math.max(0, Math.floor((Date.now() - new Date(client.dataFecho).getTime()) / 2_629_800_000)) : 0,
    valor_recorrente_anual: client.recorrenteAnual ?? 0,
    numero_projetos: opportunities.filter((item) => item.empresaId === client.empresaId).length,
  }));

  const datedMeetings = activities.filter((activity) => activity.tipo === "reuniao" && !activity.reuniaoInferida);
  const localMeetingMonths = [...datedMeetings.reduce((map, activity) => {
    const date = new Date(activity.data); const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const row = map.get(key) ?? { key, mes: date.toLocaleDateString("pt-PT", { month: "short" }).replace(".", ""), valor: 0 };
    row.valor += 1; map.set(key, row); return map;
  }, new Map<string, { key: string; mes: string; valor: number }>()).values()].sort((a, b) => a.key.localeCompare(b.key));
  const localConversion = [
    { etapa: "Contactado", total: contacted.length, taxa: 100 },
    { etapa: "Reunião feita", total: met.length, taxa: contacted.length ? 100 * met.length / contacted.length : 0 },
    { etapa: "Cliente", total: clients.length, taxa: met.length ? 100 * clients.length / met.length : 0 },
  ];

  const serverCohorts = serverMetrics?.cohorts.length ? serverMetrics.cohorts.map((row) => ({ mes: new Date(row.coorte).toLocaleDateString("pt-PT", { month: "short" }).replace(".", ""), valor: Number(row.taxa_reuniao) })) : null;
  const displayCohorts = serverCohorts ?? localMeetingMonths;
  const displayTime = serverMetrics?.time.length ? serverMetrics.time.map((row) => ({ etapa: stageLabels[String(row.estado) as keyof typeof stageLabels] ?? String(row.estado).replaceAll("_", " "), mediana: Number(row.mediana_dias), media: Number(row.media_dias), ativos: Number(row.n_ainda_ativos) })) : localTime;
  const displayDistribution = serverMetrics?.verticals.length ? serverMetrics.verticals.map((row) => ({ vertical: String(row.vertical).replaceAll("_", " "), total: Number(row.n), valor: Number(row.valor_total) })) : localDistribution;
  const hasServerFunnelHistory = serverMetrics?.funnel.some((row) => Number(row.ordem) > 1 && Number(row.taxa_passo) > 0);
  const displayConversion = hasServerFunnelHistory ? serverMetrics!.funnel.map((row) => ({ etapa: stageLabels[String(row.estado) as keyof typeof stageLabels] ?? String(row.estado).replaceAll("_", " "), total: Number(row.n), taxa: Number(row.taxa_passo) })) : localConversion;
  const displayClients = serverMetrics?.clients.length ? serverMetrics.clients : localClients;
  const averageObservedRevenue = displayClients.length ? displayClients.reduce((sum, client) => sum + Number(client.faturacao_acumulada), 0) / displayClients.length : 0;
  const pipelineValue = serverMetrics?.pipeline?.pipeline_ponderado !== undefined ? Number(serverMetrics.pipeline.pipeline_ponderado) : weighted;
  const noShowN = Number(serverMetrics?.noShow?.n_marcadas ?? 0);
  const cycleN = Number(serverMetrics?.cycle?.n ?? localCycleMonths.length);
  const cycleMedian = cycleN ? (serverMetrics?.cycle?.mediana_meses != null ? Number(serverMetrics.cycle.mediana_meses) : localCycleMedian) : null;
  const cycleAverage = cycleN ? (serverMetrics?.cycle?.media_meses != null ? Number(serverMetrics.cycle.media_meses) : localCycleAverage) : null;
  const clientRate = contacted.length ? 100 * clients.length / contacted.length : null;
  const maxDistributionValue = Math.max(1, ...displayDistribution.map((item) => item.valor));
  const missingMeetingDates = leads.filter((lead) => lead.estado === "reuniao_feita" && !lead.dataReuniao).length;

  return (
    <div className="page">
      <PageHeader eyebrow="Honestidade estatística" title="Métricas comerciais" description="Cada percentagem mostra a amostra real que a sustenta. Sinais de reunião detetados no Gmail ficam por confirmar e não entram nesta taxa." actions={<><label className="select-button"><CalendarRange size={15} />Histórico disponível<select defaultValue="all"><option value="all">Todo o histórico</option></select><ChevronDown size={14} /></label><label className="select-button"><Users size={15} />Toda a equipa<select><option>Toda a equipa</option></select><ChevronDown size={14} /></label></>} />
      <section className="metric-grid metric-grid--5">
        <MetricCard label={serverMetrics ? "Taxa de reunião por empresa" : "Taxa de reunião por contacto"} value={meetingRate === null ? "Sem amostra" : formatPercentage(meetingRate)} detail={serverMetrics ? `${meetingNumerator} em ${meetingDenominator} empresas contactadas` : `${meetingNumerator} em ${meetingDenominator} contactos · ${met.length}/${contacted.length} empresas`} icon={<Users size={17} />} />
        <MetricCard label="No-show" value={noShowN ? formatPercentage(Number(serverMetrics?.noShow?.taxa_no_show)) : "Sem amostra"} detail={noShowN ? `n=${noShowN} reuniões marcadas` : "requer presenças registadas"} icon={<CalendarRange size={17} />} />
        <MetricCard label="Cliente / base contactada" value={clientRate === null ? "Sem amostra" : formatPercentage(clientRate)} detail={`${clients.length} clientes em ${contacted.length} empresas`} icon={<Target size={17} />} />
        <MetricCard label="1.º contacto → acordo verbal" value={cycleMedian === null ? "Sem amostra" : `${formatDecimal(cycleMedian)} ${cycleMedian === 1 ? "mês" : "meses"}`} detail={cycleN ? `média: ${formatDecimal(cycleAverage ?? 0)} meses · n=${cycleN} confirmados` : "requer duração confirmada na ficha"} icon={<Clock3 size={17} />} />
        <MetricCard label="Pipeline ponderado" value={formatCurrency(pipelineValue)} detail={`${opportunities.length} oportunidades`} icon={<CircleGauge size={17} />} />
      </section>

      <section className="metrics-layout">
        <Card className="chart-panel cohort-panel">
          <div className="panel-header"><div><p className="eyebrow">{serverCohorts ? "Coorte do primeiro contacto" : "Datas confirmadas no CSV"}</p><h2>{serverCohorts ? "Taxa de reunião por coorte" : "Reuniões confirmadas por mês"}</h2></div><SampleBadge n={serverCohorts ? meetingDenominator : datedMeetings.length} /></div>
          <div className="chart-wrap chart-wrap--medium"><ResponsiveContainer width="100%" height="100%"><LineChart data={displayCohorts} margin={{ top: 15, right: 10, left: -15, bottom: 0 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tickFormatter={(value) => serverCohorts ? formatPercentage(value) : formatDecimal(value)} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 6 }} formatter={(value: number) => serverCohorts ? formatPercentage(value) : `${formatDecimal(value)} reuniões`} /><Line type="monotone" dataKey="valor" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div>
          <p className="chart-note"><BarChart3 size={14} />O CSV contém {datedMeetings.length} datas de reunião após deduplicação. {missingMeetingDates} {missingMeetingDates === 1 ? "contacto" : "contactos"} com estado “Reunião” ainda não {missingMeetingDates === 1 ? "tem" : "têm"} data.</p>
        </Card>

        <Card className="conversion-panel">
          <div className="panel-header"><div><p className="eyebrow">Funil completo</p><h2>Conversão por passo</h2></div><SampleBadge n={displayConversion[0]?.total ?? 0} /></div>
          <div className="conversion-list">{displayConversion.map((item, index) => <div key={item.etapa}><div><span className="conversion-index mono">0{index + 1}</span><span><strong>{item.etapa}</strong><small>{item.total} empresas</small></span><b className="mono">{formatPercentage(item.taxa)}</b></div><span className="conversion-track"><i style={{ width: `${Math.min(100, item.taxa)}%` }} /></span></div>)}</div>
        </Card>

        <Card className="time-panel">
          <div className="panel-header"><div><p className="eyebrow">Velocidade observada</p><h2>Tempo no estado atual</h2></div><div className="legend"><span><i className="legend-blue" />Mediana</span><span><i className="legend-white" />Média</span></div></div>
          {displayTime.length ? <div className="chart-wrap chart-wrap--medium"><ResponsiveContainer width="100%" height="100%"><BarChart data={displayTime} layout="vertical" margin={{ left: 28, right: 12 }}><CartesianGrid stroke="var(--line)" horizontal={false} /><XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} unit="d" /><YAxis dataKey="etapa" type="category" axisLine={false} tickLine={false} width={110} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 6 }} formatter={(value: number) => `${formatDecimal(value)} dias`} /><Bar dataKey="media" fill="var(--line-strong)" radius={[0, 2, 2, 0]} /><Bar dataKey="mediana" fill="#3b82f6" radius={[0, 2, 2, 0]} /></BarChart></ResponsiveContainer></div> : <p className="chart-note">Sem histórico de mudanças suficiente para calcular o tempo por estado.</p>}
        </Card>

        <Card className="distribution-panel">
          <div className="panel-header"><div><p className="eyebrow">Composição</p><h2>Pipeline por vertical</h2></div><span className="mono panel-total">{formatCurrency(displayDistribution.reduce((sum, item) => sum + item.valor, 0))}</span></div>
          <div className="distribution-list">{displayDistribution.map((item, index) => <div key={item.vertical}><span><i style={{ opacity: Math.max(.25, 1 - index * 0.1) }} /><strong>{item.vertical}</strong><small>{item.total} oportunidades</small></span><div><span className="distribution-bar"><i style={{ width: `${item.valor ? item.valor / maxDistributionValue * 100 : item.total / Math.max(1, displayDistribution[0]?.total) * 100}%` }} /></span><b className="mono">{formatCurrency(item.valor)}</b></div></div>)}</div>
        </Card>

        <Card className="client-metrics-panel">
          <div className="panel-header"><div><p className="eyebrow">Carteira observada</p><h2>Valor e projetos por cliente</h2></div><div><small>Receita acumulada média</small><strong className="mono panel-total">{formatCurrency(averageObservedRevenue)}</strong></div></div>
          <p className="chart-note"><TrendingUp size={14} />Receita realizada sem IVA até hoje; só será LTV quando existir histórico de retenção suficiente.</p>
          <table className="data-table"><thead><tr><th>Cliente</th><th>Receita acumulada</th><th>Meses ativo</th><th>Projetos</th><th>Recorrente anual</th></tr></thead><tbody>{displayClients.map((client) => <tr key={client.empresa_id}><td><strong>{client.nome}</strong></td><td className="mono">{formatCurrency(Number(client.faturacao_acumulada))}</td><td className="mono">{Number(client.meses_ativo) || "—"}</td><td className="mono">{client.numero_projetos}</td><td className="mono">{formatCurrency(Number(client.valor_recorrente_anual))}</td></tr>)}</tbody></table>
        </Card>
      </section>
    </div>
  );
}
