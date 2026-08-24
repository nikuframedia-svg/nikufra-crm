import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, CalendarCheck2, ChevronRight, CircleDollarSign, Target, TrendingUp, UserPlus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { stageOrder } from "../data/seed";
import { formatCurrency } from "../lib/format";
import { useRevenueData } from "../hooks/use-revenue-data";
import { useCRM } from "../state/crm-context";
import { Avatar, Button, Card, PageHeader } from "../components/ui";

function weekLabel(dateValue: string) {
  const date = new Date(dateValue); const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `S${String(Math.ceil((((date.getTime() - start.getTime()) / 86_400_000) + start.getUTCDay() + 1) / 7)).padStart(2, "0")}`;
}

export function TeamPage() {
  const { opportunities, activities, team } = useCRM();
  const { entries: revenueEntries } = useRevenueData();
  const [selected, setSelected] = useState(team[0]?.id ?? "");
  useEffect(() => { if (!team.some((owner) => owner.id === selected) && team[0]) setSelected(team[0].id); }, [selected, team]);
  const member = team.find((owner) => owner.id === selected) ?? team[0];
  const stats = useMemo(() => new Map(team.map((owner) => {
    const ownerOpportunities = opportunities.filter((item) => item.ownerId === owner.id);
    const ownerActivities = activities.filter((item) => item.userId === owner.id);
    const opportunityIds = new Set(ownerOpportunities.map((item) => item.id));
    const pipeline = ownerOpportunities.filter((item) => stageOrder.includes(item.estado)).reduce((sum, item) => sum + item.valor, 0);
    const faturado = revenueEntries.filter((entry) => entry.tipo === "Faturado" && entry.oportunidadeId && opportunityIds.has(entry.oportunidadeId)).reduce((sum, entry) => sum + entry.valor, 0);
    const proposals = new Set([...ownerActivities.filter((item) => item.tipo === "proposta").map((item) => item.oportunidadeId), ...ownerOpportunities.filter((item) => ["proposta", "piloto", "cliente"].includes(item.estado)).map((item) => item.id)]).size;
    return [owner.id, { reunioes: ownerActivities.filter((item) => item.tipo === "reuniao" && !item.reuniaoInferida).length, atividades: ownerActivities.length, propostas: proposals, pipeline, faturado, oportunidades: ownerOpportunities.length }];
  })), [activities, opportunities, team]);
  const memberStats = member ? stats.get(member.id) : undefined;
  const weekly = useMemo(() => {
    const grouped = new Map<string, { semana: string; email: number; reuniao: number; chamada: number; proposta: number }>();
    for (const item of activities.filter((activity) => activity.userId === selected)) {
      const semana = weekLabel(item.data); const row = grouped.get(semana) ?? { semana, email: 0, reuniao: 0, chamada: 0, proposta: 0 };
      row[item.tipo === "nota" ? "chamada" : item.tipo] += 1; grouped.set(semana, row);
    }
    return [...grouped.values()].sort((a, b) => a.semana.localeCompare(b.semana)).slice(-8);
  }, [activities, selected]);
  const ranking = [...team].sort((a, b) => (stats.get(b.id)?.pipeline ?? 0) - (stats.get(a.id)?.pipeline ?? 0));

  if (!member || !memberStats) return <div className="page"><PageHeader eyebrow="Equipa" title="Sem utilizadores ativos" description="Ativa uma conta real nas Definições para começar a atribuir leads." /></div>;
  return (
    <div className="page">
      <PageHeader eyebrow="Transparência de equipa" title="Equipa comercial" description="Distribuição real de trabalho, atividade e resultados por pessoa e ao longo do tempo." actions={<Link to="/definicoes"><Button><UserPlus size={16} />Gerir utilizadores</Button></Link>} />
      <section className="team-cards">{team.map((owner) => { const data = stats.get(owner.id)!; return <button key={owner.id} className={`team-card ${selected === owner.id ? "is-selected" : ""}`} onClick={() => setSelected(owner.id)}><div><Avatar ownerId={owner.id} size="lg" /><span><strong>{owner.nome}</strong><small>{owner.role === "admin" ? "Administrador" : "Membro"}</small></span><ChevronRight size={16} /></div><div><span><small>Pipeline</small><b className="mono">{formatCurrency(data.pipeline, true)}</b></span><span><small>Oportunidades</small><b className="mono">{data.oportunidades}</b></span><span><small>Atividades</small><b className="mono">{data.atividades}</b></span></div></button>; })}</section>
      <section className="team-detail">
        <Card className="member-overview"><div className="member-title"><Avatar ownerId={selected} size="lg" /><div><p className="eyebrow">Vista individual</p><h2>{member.nome}</h2><span>{member.email}</span></div></div><div className="member-metrics"><div><span><CalendarCheck2 size={16} />Reuniões confirmadas</span><strong className="mono">{memberStats.reunioes}</strong><small>histórico disponível</small></div><div><span><Activity size={16} />Atividades</span><strong className="mono">{memberStats.atividades}</strong><small>emails, chamadas e reuniões</small></div><div><span><Target size={16} />Propostas</span><strong className="mono">{memberStats.propostas}</strong><small>oportunidades que chegaram à proposta</small></div><div><span><CircleDollarSign size={16} />Faturado sem IVA</span><strong className="mono">{formatCurrency(memberStats.faturado, true)}</strong><small>movimentos atribuídos</small></div></div><div className="member-chart"><div className="panel-header"><div><p className="eyebrow">Ritmo semanal</p><h3>Atividade por tipo</h3></div></div>{weekly.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={weekly}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="semana" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)" }} /><Bar dataKey="email" stackId="a" fill="#3b82f6" /><Bar dataKey="chamada" stackId="a" fill="#6366f1" /><Bar dataKey="proposta" stackId="a" fill="#f59e0b" /><Bar dataKey="reuniao" stackId="a" fill="#22c55e" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer> : <div className="empty-state">Sem atividades registadas para esta pessoa.</div>}</div></Card>
        <Card className="team-ranking"><div className="panel-header"><div><p className="eyebrow">Comparação factual</p><h2>Distribuição da equipa</h2></div><TrendingUp size={17} /></div><div className="ranking-list">{ranking.map((owner, index) => { const item = stats.get(owner.id)!; return <button key={owner.id} onClick={() => setSelected(owner.id)}><span className="rank mono">{String(index + 1).padStart(2, "0")}</span><Avatar ownerId={owner.id} size="sm" /><span><strong>{owner.nome}</strong><small>{item.reunioes} reuniões · {item.propostas} propostas</small></span><b className="mono">{formatCurrency(item.pipeline, true)}</b></button>; })}</div><div className="team-timeline"><h3>Última atividade de {member.nome.split(" ")[0]}</h3>{activities.filter((item) => item.userId === selected).slice(0, 4).map((item) => <div key={item.id}><span className={`timeline__icon timeline__icon--${item.tipo}`}><Activity size={12} /></span><p><strong>{item.empresa}</strong><span>{item.descricao}</span></p></div>)}</div></Card>
      </section>
    </div>
  );
}
