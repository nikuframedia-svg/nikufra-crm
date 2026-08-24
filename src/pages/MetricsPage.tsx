import { BarChart3, CalendarRange, ChevronDown, CircleGauge, Clock3, Target, TrendingUp, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { cohortData, conversionData, stageLabels } from "../data/seed";
import { formatCurrency } from "../lib/format";
import { supabase } from "../lib/supabase";
import { useCRM } from "../state/crm-context";
import { Card, MetricCard, PageHeader, SampleBadge } from "../components/ui";

const timeByStage = [
  { etapa: "Não contactado", mediana: 3, media: 4.2, ativos: 2 },
  { etapa: "Contactado", mediana: 12, media: 15.8, ativos: 2 },
  { etapa: "Reunião marcada", mediana: 8, media: 9.4, ativos: 1 },
  { etapa: "Reunião feita", mediana: 18, media: 21.3, ativos: 2 },
  { etapa: "Proposta", mediana: 29, media: 34.5, ativos: 2 },
  { etapa: "Piloto", mediana: 63, media: 71.2, ativos: 2 },
];

const distribution = [
  { vertical: "Metalomecânica", total: 5, valor: 327000 },
  { vertical: "Automóvel", total: 4, valor: 276000 },
  { vertical: "Alumínio", total: 2, valor: 131000 },
  { vertical: "Eletrónica", total: 2, valor: 92000 },
  { vertical: "Cortiça", total: 2, valor: 161000 },
  { vertical: "Compósitos", total: 1, valor: 56000 },
];

export function MetricsPage() {
  const { opportunities } = useCRM();
  const weighted = opportunities.reduce((sum, item) => sum + item.valor * item.probabilidade / 100, 0);
  const { data: serverMetrics } = useQuery({
    queryKey: ["crm-metrics"],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const [cohorts, noShow, cycle, pipeline, results, funnel, time, verticals, clients] = await Promise.all([
        supabase!.from("metricas_taxa_reuniao_coorte").select("*"), supabase!.from("metricas_no_show").select("*"), supabase!.from("metricas_ciclo_venda").select("*"), supabase!.from("metricas_pipeline").select("*"), supabase!.from("metricas_resultados").select("*"), supabase!.from("metricas_funil").select("*").order("ordem"), supabase!.from("metricas_tempo_estado").select("*"), supabase!.from("metricas_distribuicao_vertical").select("*"), supabase!.from("metricas_cliente").select("*").order("faturacao_acumulada", { ascending: false }),
      ]);
      const firstError = [cohorts, noShow, cycle, pipeline, results, funnel, time, verticals, clients].find((result) => result.error)?.error;
      if (firstError) throw firstError;
      return { cohorts: cohorts.data ?? [], noShow: noShow.data?.[0], cycle: cycle.data?.[0], pipeline: pipeline.data?.[0], results: results.data?.[0], funnel: funnel.data ?? [], time: time.data ?? [], verticals: verticals.data ?? [], clients: clients.data ?? [] };
    },
  });
  const cohortTotals = serverMetrics?.cohorts.reduce((acc, row) => ({ contacted: acc.contacted + Number(row.n_contactadas), meetings: acc.meetings + Number(row.n_reunioes) }), { contacted: 0, meetings: 0 });
  const meetingRate = cohortTotals?.contacted ? 100 * cohortTotals.meetings / cohortTotals.contacted : 55.9;
  const displayCohorts = serverMetrics?.cohorts.length ? serverMetrics.cohorts.map((row) => ({ mes: new Date(row.coorte).toLocaleDateString("pt-PT", { month: "short" }).replace(".", ""), reuniao: Number(row.taxa_reuniao), proposta: 0, cliente: 0 })) : cohortData;
  const displayTime = serverMetrics?.time.length ? serverMetrics.time.map((row) => ({ etapa: stageLabels[String(row.estado) as keyof typeof stageLabels] ?? String(row.estado).replaceAll("_", " "), mediana: Number(row.mediana_dias), media: Number(row.media_dias), ativos: Number(row.n_ainda_ativos) })) : timeByStage;
  const displayDistribution = serverMetrics?.verticals.length ? serverMetrics.verticals.map((row) => ({ vertical: String(row.vertical).replaceAll("_", " "), total: Number(row.n), valor: Number(row.valor_total) })) : distribution;
  const displayConversion = serverMetrics?.funnel.length ? serverMetrics.funnel.map((row) => ({ etapa: stageLabels[String(row.estado) as keyof typeof stageLabels] ?? String(row.estado).replaceAll("_", " "), total: Number(row.n), taxa: Number(row.taxa_passo) })) : conversionData;
  const displayClients = serverMetrics?.clients.length ? serverMetrics.clients : [
    { empresa_id: "demo-1", nome: "Corkline", faturacao_acumulada: 120000, meses_ativo: 15, valor_recorrente_anual: 36000, numero_projetos: 2 },
    { empresa_id: "demo-2", nome: "Precision Tooling", faturacao_acumulada: 88000, meses_ativo: 12, valor_recorrente_anual: 28000, numero_projetos: 1 },
  ];
  const averageObservedRevenue = displayClients.reduce((sum, client) => sum + Number(client.faturacao_acumulada), 0) / Math.max(displayClients.length, 1);
  const pipelineValue = serverMetrics?.pipeline?.pipeline_ponderado ? Number(serverMetrics.pipeline.pipeline_ponderado) : weighted;
  return (
    <div className="page">
      <PageHeader eyebrow="Honestidade estatística" title="Métricas comerciais" description="Cada percentagem mostra a amostra que a sustenta. Valores com n<5 são apenas indicativos." actions={<><label className="select-button"><CalendarRange size={15} />Últimos 12 meses<select defaultValue="12"><option value="3">Últimos 3 meses</option><option value="6">Últimos 6 meses</option><option value="12">Últimos 12 meses</option></select><ChevronDown size={14} /></label><label className="select-button"><Users size={15} />Toda a equipa<select><option>Toda a equipa</option></select><ChevronDown size={14} /></label></>} />
      <section className="metric-grid metric-grid--5">
        <MetricCard label="Taxa de reunião" value={`${meetingRate.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`} change="+7,1 pp" detail={`n=${cohortTotals?.contacted ?? 34}`} icon={<Users size={17} />} />
        <MetricCard label="No-show" value={`${Number(serverMetrics?.noShow?.taxa_no_show ?? 17.4).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`} change="−3,2 pp" detail={`n=${serverMetrics?.noShow?.n_marcadas ?? 23}`} icon={<CalendarRange size={17} />} />
        <MetricCard label="Taxa de ganho" value={`${Number(serverMetrics?.results?.taxa_ganho ?? 26.1).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`} change="+2,8 pp" detail={`${serverMetrics?.results?.n_clientes ?? 6} em ${serverMetrics?.results?.n_finalizadas ?? 23} deals`} icon={<Target size={17} />} />
        <MetricCard label="Ciclo mediano" value={`${Math.round(Number(serverMetrics?.cycle?.mediana_dias ?? 146))} dias`} change="−18 dias" detail={`média: ${Math.round(Number(serverMetrics?.cycle?.media_dias ?? 172))} dias · n=${serverMetrics?.cycle?.n ?? 6}`} icon={<Clock3 size={17} />} />
        <MetricCard label="Pipeline ponderado" value={formatCurrency(pipelineValue, true)} change="+8,1%" detail="cobertura: 2,7×" icon={<CircleGauge size={17} />} />
      </section>

      <section className="metrics-layout">
        <Card className="chart-panel cohort-panel">
          <div className="panel-header"><div><p className="eyebrow">Coorte do primeiro contacto</p><h2>Conversão acumulada</h2></div><div className="legend"><span><i className="legend-blue" />Reunião</span><span><i className="legend-white" />Proposta</span><span><i className="legend-muted" />Cliente</span></div></div>
          <div className="chart-wrap chart-wrap--medium"><ResponsiveContainer width="100%" height="100%"><LineChart data={displayCohorts} margin={{ top: 15, right: 10, left: -15, bottom: 0 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `${value}%`} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 6 }} formatter={(value: number) => `${value}%`} /><Line type="monotone" dataKey="reuniao" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} /><Line type="monotone" dataKey="proposta" stroke="var(--ink)" strokeWidth={1.5} dot={false} /><Line type="monotone" dataKey="cliente" stroke="var(--muted)" strokeWidth={1.5} dot={false} /></LineChart></ResponsiveContainer></div>
          <p className="chart-note"><BarChart3 size={14} />A coorte de agosto ainda está em maturação. Não compares diretamente com meses fechados.</p>
        </Card>

        <Card className="conversion-panel">
          <div className="panel-header"><div><p className="eyebrow">Funil completo</p><h2>Conversão por passo</h2></div><SampleBadge n={displayConversion[0]?.total ?? 0} /></div>
          <div className="conversion-list">{displayConversion.map((item, index) => <div key={item.etapa}><div><span className="conversion-index mono">0{index + 1}</span><span><strong>{item.etapa}</strong><small>{item.total} oportunidades</small></span><b className="mono">{item.taxa}%</b></div><span className="conversion-track"><i style={{ width: `${item.taxa}%` }} /></span></div>)}</div>
        </Card>

        <Card className="time-panel">
          <div className="panel-header"><div><p className="eyebrow">Velocidade</p><h2>Tempo por estado</h2></div><div className="legend"><span><i className="legend-blue" />Mediana</span><span><i className="legend-white" />Média</span></div></div>
          <div className="chart-wrap chart-wrap--medium"><ResponsiveContainer width="100%" height="100%"><BarChart data={displayTime} layout="vertical" margin={{ left: 28, right: 12 }}><CartesianGrid stroke="var(--line)" horizontal={false} /><XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} unit="d" /><YAxis dataKey="etapa" type="category" axisLine={false} tickLine={false} width={110} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 6 }} formatter={(value: number) => `${value} dias`} /><Bar dataKey="media" fill="var(--line-strong)" radius={[0, 2, 2, 0]} /><Bar dataKey="mediana" fill="#3b82f6" radius={[0, 2, 2, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>

        <Card className="distribution-panel">
          <div className="panel-header"><div><p className="eyebrow">Composição</p><h2>Pipeline por vertical</h2></div><span className="mono panel-total">{formatCurrency(displayDistribution.reduce((sum, item) => sum + item.valor, 0), true)}</span></div>
          <div className="distribution-list">{displayDistribution.map((item, index) => <div key={item.vertical}><span><i style={{ opacity: 1 - index * 0.1 }} /><strong>{item.vertical}</strong><small>{item.total} oportunidades</small></span><div><span className="distribution-bar"><i style={{ width: `${item.valor / displayDistribution[0].valor * 100}%` }} /></span><b className="mono">{formatCurrency(item.valor, true)}</b></div></div>)}</div>
        </Card>

        <Card className="client-metrics-panel">
          <div className="panel-header"><div><p className="eyebrow">Carteira observada</p><h2>Valor e projetos por cliente</h2></div><div><small>Receita acumulada média</small><strong className="mono panel-total">{formatCurrency(averageObservedRevenue, true)}</strong></div></div>
          <p className="chart-note"><TrendingUp size={14} />Receita realizada até hoje; não é uma projeção de LTV enquanto o histórico for curto.</p>
          <table className="data-table"><thead><tr><th>Cliente</th><th>Receita acumulada</th><th>Meses ativo</th><th>Projetos</th><th>Recorrente anual</th></tr></thead><tbody>{displayClients.map((client) => <tr key={client.empresa_id}><td><strong>{client.nome}</strong></td><td className="mono">{formatCurrency(Number(client.faturacao_acumulada))}</td><td className="mono">{Number(client.meses_ativo) || 0}</td><td className="mono">{client.numero_projetos}</td><td className="mono">{formatCurrency(Number(client.valor_recorrente_anual))}</td></tr>)}</tbody></table>
        </Card>
      </section>
    </div>
  );
}
