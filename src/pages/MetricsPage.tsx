import { BarChart3, CalendarRange, ChevronDown, CircleGauge, Clock3, Target, TrendingUp, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cohortData, conversionData } from "../data/seed";
import { formatCurrency } from "../lib/format";
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
  return (
    <div className="page">
      <PageHeader eyebrow="Honestidade estatística" title="Métricas comerciais" description="Cada percentagem mostra a amostra que a sustenta. Valores com n<5 são apenas indicativos." actions={<><label className="select-button"><CalendarRange size={15} />Últimos 12 meses<select defaultValue="12"><option value="3">Últimos 3 meses</option><option value="6">Últimos 6 meses</option><option value="12">Últimos 12 meses</option></select><ChevronDown size={14} /></label><label className="select-button"><Users size={15} />Toda a equipa<select><option>Toda a equipa</option></select><ChevronDown size={14} /></label></>} />
      <section className="metric-grid metric-grid--5">
        <MetricCard label="Taxa de reunião" value="55,9%" change="+7,1 pp" detail="vs. coorte anterior" icon={<Users size={17} />} />
        <MetricCard label="No-show" value="17,4%" change="−3,2 pp" detail="4 em 23 reuniões" icon={<CalendarRange size={17} />} />
        <MetricCard label="Taxa de ganho" value="26,1%" change="+2,8 pp" detail="6 em 23 deals" icon={<Target size={17} />} />
        <MetricCard label="Ciclo mediano" value="146 dias" change="−18 dias" detail="média: 172 dias" icon={<Clock3 size={17} />} />
        <MetricCard label="Pipeline ponderado" value={formatCurrency(weighted, true)} change="+8,1%" detail="cobertura: 2,7×" icon={<CircleGauge size={17} />} />
      </section>

      <section className="metrics-layout">
        <Card className="chart-panel cohort-panel">
          <div className="panel-header"><div><p className="eyebrow">Coorte do primeiro contacto</p><h2>Conversão acumulada</h2></div><div className="legend"><span><i className="legend-blue" />Reunião</span><span><i className="legend-white" />Proposta</span><span><i className="legend-muted" />Cliente</span></div></div>
          <div className="chart-wrap chart-wrap--medium"><ResponsiveContainer width="100%" height="100%"><LineChart data={cohortData} margin={{ top: 15, right: 10, left: -15, bottom: 0 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `${value}%`} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 6 }} formatter={(value: number) => `${value}%`} /><Line type="monotone" dataKey="reuniao" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} /><Line type="monotone" dataKey="proposta" stroke="var(--ink)" strokeWidth={1.5} dot={false} /><Line type="monotone" dataKey="cliente" stroke="var(--muted)" strokeWidth={1.5} dot={false} /></LineChart></ResponsiveContainer></div>
          <p className="chart-note"><BarChart3 size={14} />A coorte de agosto ainda está em maturação. Não compares diretamente com meses fechados.</p>
        </Card>

        <Card className="conversion-panel">
          <div className="panel-header"><div><p className="eyebrow">Funil completo</p><h2>Conversão por passo</h2></div><SampleBadge n={34} /></div>
          <div className="conversion-list">{conversionData.map((item, index) => <div key={item.etapa}><div><span className="conversion-index mono">0{index + 1}</span><span><strong>{item.etapa}</strong><small>{item.total} oportunidades</small></span><b className="mono">{item.taxa}%</b></div><span className="conversion-track"><i style={{ width: `${item.taxa}%` }} /></span></div>)}</div>
        </Card>

        <Card className="time-panel">
          <div className="panel-header"><div><p className="eyebrow">Velocidade</p><h2>Tempo por estado</h2></div><div className="legend"><span><i className="legend-blue" />Mediana</span><span><i className="legend-white" />Média</span></div></div>
          <div className="chart-wrap chart-wrap--medium"><ResponsiveContainer width="100%" height="100%"><BarChart data={timeByStage} layout="vertical" margin={{ left: 28, right: 12 }}><CartesianGrid stroke="var(--line)" horizontal={false} /><XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} unit="d" /><YAxis dataKey="etapa" type="category" axisLine={false} tickLine={false} width={110} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 6 }} formatter={(value: number) => `${value} dias`} /><Bar dataKey="media" fill="var(--line-strong)" radius={[0, 2, 2, 0]} /><Bar dataKey="mediana" fill="#3b82f6" radius={[0, 2, 2, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>

        <Card className="distribution-panel">
          <div className="panel-header"><div><p className="eyebrow">Composição</p><h2>Pipeline por vertical</h2></div><span className="mono panel-total">{formatCurrency(distribution.reduce((sum, item) => sum + item.valor, 0), true)}</span></div>
          <div className="distribution-list">{distribution.map((item, index) => <div key={item.vertical}><span><i style={{ opacity: 1 - index * 0.1 }} /><strong>{item.vertical}</strong><small>{item.total} oportunidades</small></span><div><span className="distribution-bar"><i style={{ width: `${item.valor / distribution[0].valor * 100}%` }} /></span><b className="mono">{formatCurrency(item.valor, true)}</b></div></div>)}</div>
        </Card>
      </section>
    </div>
  );
}
