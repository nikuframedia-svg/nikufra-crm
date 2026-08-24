import { useEffect, useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, CalendarRange, ChevronDown, CircleDollarSign, Plus, ReceiptText, Target } from "lucide-react";
import { revenueMonths } from "../data/seed";
import { formatCurrency } from "../lib/format";
import { Button, Card, MetricCard, Modal, PageHeader } from "../components/ui";
import { supabase } from "../lib/supabase";
import { useCRM } from "../state/crm-context";

const ledger = [
  { data: "21/08/2026", empresa: "Precision Tooling", descricao: "Licença PP1 — agosto", tipo: "Recebido", valor: 14500, ref: "FT 2026/118" },
  { data: "18/08/2026", empresa: "Corkline", descricao: "Milestone 2 — integração MES", tipo: "Faturado", valor: 22000, ref: "FT 2026/115" },
  { data: "12/08/2026", empresa: "Alumitech", descricao: "Extensão do piloto", tipo: "Contratualizado", valor: 28000, ref: "PROP-084" },
  { data: "05/08/2026", empresa: "Precision Tooling", descricao: "Setup segunda unidade", tipo: "Contratualizado", valor: 36000, ref: "PROP-081" },
  { data: "02/08/2026", empresa: "Corkline", descricao: "Retainer mensal", tipo: "Recebido", valor: 8500, ref: "FT 2026/109" },
];

export function RevenuePage() {
  const { opportunities } = useCRM();
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryError, setEntryError] = useState("");
  const [entries, setEntries] = useState(ledger);
  const [months, setMonths] = useState(revenueMonths);
  const totals = useMemo(() => months.reduce((acc, item) => ({ contratualizado: acc.contratualizado + item.contratualizado, faturado: acc.faturado + item.faturado, recebido: acc.recebido + item.recebido, objetivo: acc.objetivo + item.objetivo }), { contratualizado: 0, faturado: 0, recebido: 0, objetivo: 0 }), [months]);
  const average = totals.faturado / months.length;
  const companies = useMemo(() => [...new Set(opportunities.map((item) => item.empresa))].sort(), [opportunities]);

  useEffect(() => {
    if (!supabase) return;
    void Promise.all([
      supabase.from("faturacao").select("id,tipo,valor,data,descricao,referencia_externa,empresas(nome)").order("data", { ascending: false }),
      supabase.from("objetivos").select("ano,mes,tipo,valor_alvo").eq("tipo", "faturacao"),
    ]).then(([billing, goals]) => {
      if (billing.data) {
        const now = new Date();
        const base = Array.from({ length: 12 }, (_, index) => { const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1); return { key: `${date.getFullYear()}-${date.getMonth() + 1}`, mes: date.toLocaleDateString("pt-PT", { month: "short" }).replace(".", ""), contratualizado: 0, faturado: 0, recebido: 0, objetivo: 0 }; });
        for (const row of billing.data) { const date = new Date(row.data); const month = base.find((item) => item.key === `${date.getFullYear()}-${date.getMonth() + 1}`); if (month) month[row.tipo as "contratualizado" | "faturado" | "recebido"] += Number(row.valor); }
        for (const row of goals.data ?? []) { const month = base.find((item) => item.key === `${row.ano}-${row.mes}`); if (month) month.objetivo = Number(row.valor_alvo); }
        setMonths(base.map(({ key: _key, ...item }) => item));
        setEntries(billing.data.map((row) => ({ data: new Date(row.data).toLocaleDateString("pt-PT"), empresa: (Array.isArray(row.empresas) ? row.empresas[0]?.nome : (row.empresas as { nome: string } | null)?.nome) ?? "Empresa", descricao: row.descricao, tipo: row.tipo === "faturado" ? "Faturado" : row.tipo === "recebido" ? "Recebido" : "Contratualizado", valor: Number(row.valor), ref: row.referencia_externa ?? "—" })));
      }
    });
  }, []);

  async function handleEntry(formData: FormData) {
    const entry = { data: new Date(String(formData.get("data"))).toLocaleDateString("pt-PT"), empresa: String(formData.get("empresa")), descricao: String(formData.get("descricao")), tipo: String(formData.get("tipo")), valor: Number(formData.get("valor")), ref: String(formData.get("ref")) };
    if (supabase) {
      const opportunity = opportunities.find((item) => item.empresa.toLowerCase() === entry.empresa.toLowerCase() && item.empresaId);
      if (!opportunity?.empresaId) { setEntryError("Seleciona uma empresa com oportunidade no CRM."); return; }
      const { error } = await supabase.from("faturacao").insert({ empresa_id: opportunity.empresaId, oportunidade_id: opportunity.id, tipo: entry.tipo.toLowerCase(), valor: entry.valor, data: String(formData.get("data")), descricao: entry.descricao, referencia_externa: entry.ref || null });
      if (error) { setEntryError(error.message); return; }
    }
    setEntries((current) => [entry, ...current]);
    const entryDate = new Date(String(formData.get("data")));
    const now = new Date();
    if (entryDate.getFullYear() === now.getFullYear() && entryDate.getMonth() === now.getMonth()) {
      const key = entry.tipo.toLowerCase() as "contratualizado" | "faturado" | "recebido";
      setMonths((current) => current.map((month, index) => index === current.length - 1 ? { ...month, [key]: month[key] + entry.valor } : month));
    }
    setEntryError("");
    setEntryOpen(false);
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Receita operacional" title="Faturação e objetivos" description="Espelho de KPI. A fonte contabilística continua a ser o software certificado." actions={<Button onClick={() => { setEntryError(""); setEntryOpen(true); }}><Plus size={16} />Novo lançamento</Button>} />
      <section className="metric-grid">
        <MetricCard label="Contratualizado YTD" value={formatCurrency(totals.contratualizado, true)} change="+23,8%" detail="vs. período anterior" icon={<ReceiptText size={17} />} />
        <MetricCard label="Faturado YTD" value={formatCurrency(totals.faturado, true)} change="+18,6%" detail={`${Math.round(totals.faturado / totals.objetivo * 100)}% do objetivo`} icon={<CircleDollarSign size={17} />} />
        <MetricCard label="Recebido YTD" value={formatCurrency(totals.recebido, true)} change="+16,2%" detail="prazo médio: 34 dias" icon={<ArrowUpRight size={17} />} />
        <MetricCard label="Média mensal" value={formatCurrency(average, true)} change="+11,4%" detail="média móvel 6m: 50,8k €" icon={<Target size={17} />} />
      </section>
      <Card className="chart-panel revenue-chart-panel">
        <div className="panel-header"><div><p className="eyebrow">Últimos 12 meses</p><h2>Timeline de faturação</h2></div><div className="legend"><span><i className="legend-blue" />Faturado</span><span><i className="legend-white" />Contratualizado</span><span><i className="legend-muted" />Recebido</span><span><i className="legend-dash" />Objetivo</span></div></div>
        <div className="chart-wrap chart-wrap--revenue"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={months} margin={{ top: 15, right: 10, left: 0 }}><defs><linearGradient id="receivedArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `${value / 1000}k`} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 6 }} formatter={(value: number) => formatCurrency(value, true)} /><Area type="monotone" dataKey="recebido" stroke="#22c55e" fill="url(#receivedArea)" strokeWidth={1.5} /><Bar dataKey="contratualizado" fill="var(--line-strong)" radius={[2, 2, 0, 0]} maxBarSize={22} /><Bar dataKey="faturado" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={22} /><Line type="monotone" dataKey="objetivo" stroke="var(--ink)" strokeDasharray="5 5" strokeWidth={1.2} dot={false} /></ComposedChart></ResponsiveContainer></div>
      </Card>
      <Card className="ledger-card"><div className="panel-header"><div><p className="eyebrow">Lançamentos</p><h2>Movimentos recentes</h2></div><label className="select-button"><CalendarRange size={14} />Agosto 2026<select><option>Agosto 2026</option></select><ChevronDown size={13} /></label></div><table className="data-table"><thead><tr><th>Data</th><th>Empresa</th><th>Descrição</th><th>Tipo</th><th>Referência</th><th>Valor</th></tr></thead><tbody>{entries.map((entry, index) => <tr key={`${entry.ref}-${index}`}><td className="mono">{entry.data}</td><td><strong>{entry.empresa}</strong></td><td>{entry.descricao}</td><td><span className={`revenue-type revenue-type--${entry.tipo.toLowerCase()}`}>{entry.tipo}</span></td><td className="mono">{entry.ref}</td><td className="mono align-right">{formatCurrency(entry.valor)}</td></tr>)}</tbody></table></Card>

      <Modal open={entryOpen} onClose={() => setEntryOpen(false)} title="Novo lançamento" description="Regista um movimento para atualizar os KPIs de receita.">
        <form onSubmit={(event) => { event.preventDefault(); void handleEntry(new FormData(event.currentTarget)); }} className="form-stack"><div className="form-grid"><label>Empresa<select name="empresa" required autoFocus>{companies.map((company) => <option key={company}>{company}</option>)}</select></label><label>Data<input name="data" type="date" required defaultValue="2026-08-24" /></label></div><div className="form-grid form-grid--3"><label>Tipo<select name="tipo"><option>Contratualizado</option><option>Faturado</option><option>Recebido</option></select></label><label>Valor<input name="valor" type="number" min="0" required /></label><label>Referência<input name="ref" placeholder="FT 2026/…" /></label></div><label>Descrição<input name="descricao" required /></label>{entryError ? <div className="auth-error">{entryError}</div> : null}<div className="modal__actions"><Button type="button" variant="secondary" onClick={() => setEntryOpen(false)}>Cancelar</Button><Button type="submit">Guardar lançamento</Button></div></form>
      </Modal>
    </div>
  );
}
