import { Activity, ArrowUpRight, CalendarCheck2, CircleDollarSign, Clock3, MoveRight, Target } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "@tanstack/react-router";
import { stageLabels, stageOrder } from "../data/seed";
import { formatCurrency } from "../lib/format";
import { useRevenueData } from "../hooks/use-revenue-data";
import { useCRM } from "../state/crm-context";
import { Avatar, Button, Card, MetricCard, PageHeader, SampleBadge, StageChip } from "../components/ui";

export function OverviewPage() {
  const { opportunities, activities, team, currentUserId } = useCRM();
  const { months: revenueMonths } = useRevenueData();
  const active = opportunities.filter((item) => stageOrder.includes(item.estado));
  const pipeline = active.reduce((sum, item) => sum + item.valor, 0);
  const weighted = active.reduce((sum, item) => sum + item.valor * item.probabilidade / 100, 0);
  const currentRevenue = revenueMonths.at(-1) ?? { mes: "", contratualizado: 0, faturado: 0, recebido: 0, objetivo: 0 };
  const stalled = active.filter((item) => item.diasNoEstado >= 30).sort((a, b) => b.diasNoEstado - a.diasNoEstado).slice(0, 4);

  const closedCycles = opportunities.map((item) => item.dataPrimeiroContacto && item.dataFecho ? Math.round((new Date(item.dataFecho).getTime() - new Date(item.dataPrimeiroContacto).getTime()) / 86_400_000) : null).filter((value): value is number => value !== null && value >= 0).sort((a, b) => a - b);
  const medianCycle = closedCycles.length ? closedCycles[Math.floor(closedCycles.length / 2)] : null;
  const currentName = team.find((item) => item.id === currentUserId)?.nome.split(" ")[0] ?? "João";
  const now = new Date();
  const dateLabel = now.toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="page">
      <PageHeader eyebrow={dateLabel} title={`Bom dia, ${currentName}.`} description={`${opportunities.length} empresas no CRM e ${stalled.length} negócios com 30 ou mais dias no estado atual.`} actions={<><Button variant="secondary"><CalendarCheck2 size={16} />Dados atuais</Button><Link to="/pipeline"><Button>Ver pipeline<ArrowUpRight size={16} /></Button></Link></>} />
      <section className="metric-grid">
        <MetricCard label="Pipeline total" value={formatCurrency(pipeline, true)} detail={`${active.length} empresas no funil`} icon={<Target size={17} />} />
        <MetricCard label="Pipeline ponderado" value={formatCurrency(weighted, true)} detail="com probabilidades por etapa" icon={<Activity size={17} />} />
        <MetricCard label="Faturado sem IVA" value={formatCurrency(currentRevenue.faturado, true)} detail={currentRevenue.objetivo ? `de ${formatCurrency(currentRevenue.objetivo, true)} objetivo` : "objetivo mensal ainda não definido"} icon={<CircleDollarSign size={17} />} />
        <MetricCard label="Ciclo de venda mediano" value={medianCycle === null ? "Sem amostra" : `${medianCycle} dias`} detail={`n=${closedCycles.length} negócios com datas completas`} icon={<Clock3 size={17} />} />
      </section>

      <section className="overview-grid">
        <Card className="chart-panel chart-panel--main">
          <div className="panel-header"><div><p className="eyebrow">Receita e compromisso</p><h2>Tração comercial</h2></div><div className="legend"><span><i className="legend-blue" />Faturado</span><span><i className="legend-white" />Contratualizado</span><span><i className="legend-dash" />Objetivo</span></div></div>
          <div className="chart-summary"><strong className="mono">{formatCurrency(currentRevenue.faturado + currentRevenue.contratualizado, true)}</strong><span>volume comercial em agosto</span></div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueMonths} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs><linearGradient id="areaBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.24} /><stop offset="100%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `${value / 1000}k`} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} formatter={(value: number) => formatCurrency(value, true)} />
                <Area type="monotone" dataKey="faturado" stroke="#3b82f6" strokeWidth={2} fill="url(#areaBlue)" />
                <Line type="monotone" dataKey="contratualizado" stroke="var(--ink)" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="objetivo" stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="5 5" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="attention-panel">
          <div className="panel-header"><div><p className="eyebrow">Atenção necessária</p><h2>Negócios parados</h2></div><span className="counter">{stalled.length}</span></div>
          <div className="attention-list">
            {stalled.map((item) => <div key={item.id}><div className="attention-list__top"><span className={`age-badge age-badge--${item.diasNoEstado > 45 ? "danger" : "warning"}`}>{item.diasNoEstado}d</span><Avatar ownerId={item.ownerId} size="sm" /></div><strong>{item.empresa}</strong><span>{item.titulo}</span><div><StageChip stage={item.estado} /><b className="mono">{formatCurrency(item.valor, true)}</b></div></div>)}
          </div>
          <Link to="/pipeline" className="panel-link">Abrir pipeline completo <MoveRight size={15} /></Link>
        </Card>

        <Card className="funnel-panel">
          <div className="panel-header"><div><p className="eyebrow">Funil ativo</p><h2>Distribuição por etapa</h2></div><SampleBadge n={opportunities.length} /></div>
          <div className="mini-funnel">
            {stageOrder.slice(1).map((stage, index) => {
              const count = opportunities.filter((item) => item.estado === stage).length;
              const width = Math.max(28, 100 - index * 10);
              return <div key={stage} style={{ width: `${width}%` }}><span>{stageLabels[stage]}</span><b className="mono">{count}</b></div>;
            })}
          </div>
        </Card>

        <Card className="activity-panel">
          <div className="panel-header"><div><p className="eyebrow">Histórico registado</p><h2>Atividade recente</h2></div><SampleBadge n={activities.length} /></div>
          <div className="timeline">
            {activities.slice(0, 5).map((item) => {
              const owner = team.find((value) => value.id === item.userId);
              return <div className="timeline__item" key={item.id}><span className={`timeline__icon timeline__icon--${item.tipo}`}><Activity size={13} /></span><div><p><strong>{owner?.nome ?? "Equipa Nikufra"}</strong> · {item.empresa}</p><span>{item.descricao}</span></div><time className="mono">{new Date(item.data).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}</time></div>;
            })}
          </div>
        </Card>
      </section>
    </div>
  );
}
