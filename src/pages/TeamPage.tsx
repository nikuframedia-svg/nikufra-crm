import { useEffect, useState } from "react";
import { Activity, CalendarCheck2, ChevronRight, CircleDollarSign, Plus, Target, TrendingUp, UserPlus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { owners as initialOwners } from "../data/seed";
import { formatCurrency } from "../lib/format";
import { useCRM } from "../state/crm-context";
import { Avatar, Button, Card, PageHeader } from "../components/ui";

const performance = [
  { id: "o1", reunioes: 12, atividades: 48, propostas: 5, pipeline: 312000, faturado: 142000 },
  { id: "o2", reunioes: 9, atividades: 41, propostas: 4, pipeline: 248000, faturado: 98000 },
  { id: "o3", reunioes: 8, atividades: 36, propostas: 3, pipeline: 201000, faturado: 85000 },
  { id: "o4", reunioes: 7, atividades: 32, propostas: 3, pipeline: 186000, faturado: 72000 },
];

export function TeamPage() {
  const { opportunities, activities, team } = useCRM();
  const [selected, setSelected] = useState(initialOwners[0].id);
  useEffect(() => { if (!team.some((owner) => owner.id === selected) && team[0]) setSelected(team[0].id); }, [selected, team]);
  const memberIndex = Math.max(0, team.findIndex((owner) => owner.id === selected));
  const member = team[memberIndex] ?? initialOwners[0];
  const memberPerformance = performance[memberIndex % performance.length];
  return (
    <div className="page">
      <PageHeader eyebrow="Transparência de equipa" title="Equipa comercial" description="Distribuição de trabalho, atividade e resultados por pessoa e ao longo do tempo." actions={<Button><UserPlus size={16} />Convidar utilizador</Button>} />
      <section className="team-cards">{team.map((owner, index) => { const data = performance[index % performance.length]; const opps = opportunities.filter((item) => item.ownerId === owner.id).length; return <button key={owner.id} className={`team-card ${selected === owner.id ? "is-selected" : ""}`} onClick={() => setSelected(owner.id)}><div><Avatar ownerId={owner.id} size="lg" /><span><strong>{owner.nome}</strong><small>{owner.role === "admin" ? "Administrador" : "Membro"}</small></span><ChevronRight size={16} /></div><div><span><small>Pipeline</small><b className="mono">{formatCurrency(data.pipeline, true)}</b></span><span><small>Oportunidades</small><b className="mono">{opps}</b></span><span><small>Atividades</small><b className="mono">{data.atividades}</b></span></div></button>; })}</section>
      <section className="team-detail">
        <Card className="member-overview"><div className="member-title"><Avatar ownerId={selected} size="lg" /><div><p className="eyebrow">Vista individual</p><h2>{member.nome}</h2><span>{member.email}</span></div><button className="icon-button"><Plus size={16} /></button></div><div className="member-metrics"><div><span><CalendarCheck2 size={16} />Reuniões feitas</span><strong className="mono">{memberPerformance.reunioes}</strong><small>objetivo: 10</small></div><div><span><Activity size={16} />Atividades</span><strong className="mono">{memberPerformance.atividades}</strong><small>+14% vs. média</small></div><div><span><Target size={16} />Propostas</span><strong className="mono">{memberPerformance.propostas}</strong><small>taxa: 41,7%</small></div><div><span><CircleDollarSign size={16} />Faturado</span><strong className="mono">{formatCurrency(memberPerformance.faturado, true)}</strong><small>últimos 12 meses</small></div></div><div className="member-chart"><div className="panel-header"><div><p className="eyebrow">Ritmo semanal</p><h3>Atividade por tipo</h3></div></div><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ semana: "S30", email: 14, reuniao: 3, chamada: 7 }, { semana: "S31", email: 18, reuniao: 4, chamada: 6 }, { semana: "S32", email: 16, reuniao: 2, chamada: 9 }, { semana: "S33", email: 21, reuniao: 5, chamada: 8 }, { semana: "S34", email: 19, reuniao: 4, chamada: 6 }, { semana: "S35", email: 12, reuniao: 3, chamada: 5 }]}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="semana" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)" }} /><Bar dataKey="email" stackId="a" fill="#3b82f6" /><Bar dataKey="chamada" stackId="a" fill="#6366f1" /><Bar dataKey="reuniao" stackId="a" fill="#22c55e" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
        <Card className="team-ranking"><div className="panel-header"><div><p className="eyebrow">Comparação</p><h2>Performance da equipa</h2></div><TrendingUp size={17} /></div><div className="ranking-list">{team.map((owner, index) => { const item = performance[index % performance.length]; return <button key={owner.id} onClick={() => setSelected(owner.id)}><span className="rank mono">0{index + 1}</span><Avatar ownerId={owner.id} size="sm" /><span><strong>{owner.nome}</strong><small>{item.reunioes} reuniões · {item.propostas} propostas</small></span><b className="mono">{formatCurrency(item.pipeline, true)}</b></button>; })}</div><div className="team-timeline"><h3>Última atividade de {member.nome.split(" ")[0]}</h3>{activities.filter((item) => item.userId === selected).slice(0, 4).map((item) => <div key={item.id}><span className={`timeline__icon timeline__icon--${item.tipo}`}><Activity size={12} /></span><p><strong>{item.empresa}</strong><span>{item.descricao}</span></p></div>)}</div></Card>
      </section>
    </div>
  );
}
