import { useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, CalendarRange, ChevronDown, CircleDollarSign, Plus, ReceiptText, Target } from "lucide-react";
import { formatCurrency, formatDecimal, formatPercentage } from "../lib/format";
import { useRevenueData } from "../hooks/use-revenue-data";
import { Button, Card, MetricCard, Modal, PageHeader } from "../components/ui";
import { supabase } from "../lib/supabase";
import { useCRM } from "../state/crm-context";
import type { RevenueEntry } from "../types";

export function RevenuePage() {
  const { opportunities } = useCRM();
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryError, setEntryError] = useState("");
  const { entries, setEntries, months, setMonths } = useRevenueData();
  const totals = useMemo(() => months.reduce((acc, item) => ({ contratualizado: acc.contratualizado + item.contratualizado, faturado: acc.faturado + item.faturado, recebido: acc.recebido + item.recebido, objetivo: acc.objetivo + item.objetivo }), { contratualizado: 0, faturado: 0, recebido: 0, objetivo: 0 }), [months]);
  const monthsWithBilling = months.filter((month) => month.faturado > 0).length;
  const contractedCompanies = new Set(entries.filter((entry) => entry.tipo === "Contratualizado").map((entry) => entry.empresa)).size;
  const average = totals.faturado / Math.max(monthsWithBilling, 1);
  const companies = useMemo(() => [...new Set(opportunities.map((item) => item.empresa))].sort(), [opportunities]);

  async function handleEntry(formData: FormData) {
    const entry: RevenueEntry = { id: crypto.randomUUID(), data: String(formData.get("data")), empresa: String(formData.get("empresa")), descricao: String(formData.get("descricao")), tipo: String(formData.get("tipo")) as RevenueEntry["tipo"], valor: Number(formData.get("valor")), ref: String(formData.get("ref")) };
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
        <MetricCard label="Contratualizado registado" value={formatCurrency(totals.contratualizado)} change="Dados reais" detail={`${contractedCompanies} empresa${contractedCompanies === 1 ? "" : "s"} com contrato registado`} icon={<ReceiptText size={17} />} />
        <MetricCard label="Faturado sem IVA" value={formatCurrency(totals.faturado)} change="Dados reais" detail={totals.objetivo ? `${formatPercentage(totals.faturado / totals.objetivo * 100)} do objetivo` : "Objetivo ainda não definido"} icon={<CircleDollarSign size={17} />} />
        <MetricCard label="Recebido registado" value={formatCurrency(totals.recebido)} detail="Ainda não foram fornecidos recebimentos" icon={<ArrowUpRight size={17} />} />
        <MetricCard label="Média mensal observada" value={formatCurrency(average)} detail={`${monthsWithBilling} ${monthsWithBilling === 1 ? "mês" : "meses"} com faturação registada`} icon={<Target size={17} />} />
      </section>
      <Card className="chart-panel revenue-chart-panel">
        <div className="panel-header"><div><p className="eyebrow">Últimos 12 meses</p><h2>Timeline de faturação</h2></div><div className="legend"><span><i className="legend-blue" />Faturado</span><span><i className="legend-white" />Contratualizado</span><span><i className="legend-muted" />Recebido</span><span><i className="legend-dash" />Objetivo</span></div></div>
        <div className="chart-wrap chart-wrap--revenue"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={months} margin={{ top: 15, right: 10, left: 0 }}><defs><linearGradient id="receivedArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tickFormatter={(value) => formatDecimal(value)} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 6 }} formatter={(value: number) => formatCurrency(value)} /><Area type="monotone" dataKey="recebido" stroke="#22c55e" fill="url(#receivedArea)" strokeWidth={1.5} /><Bar dataKey="contratualizado" fill="var(--line-strong)" radius={[2, 2, 0, 0]} maxBarSize={22} /><Bar dataKey="faturado" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={22} /><Line type="monotone" dataKey="objetivo" stroke="var(--ink)" strokeDasharray="5 5" strokeWidth={1.2} dot={false} /></ComposedChart></ResponsiveContainer></div>
      </Card>
      <Card className="ledger-card"><div className="panel-header"><div><p className="eyebrow">Lançamentos</p><h2>Movimentos reais</h2></div><label className="select-button"><CalendarRange size={14} />Todo o histórico<select><option>Todo o histórico</option></select><ChevronDown size={13} /></label></div><table className="data-table"><thead><tr><th>Data</th><th>Empresa</th><th>Descrição</th><th>Tipo</th><th>Referência</th><th>Valor sem IVA</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td className="mono">{new Date(`${entry.data}T12:00:00`).toLocaleDateString("pt-PT")}</td><td><strong>{entry.empresa}</strong></td><td>{entry.descricao}{entry.valorBruto && entry.valorBruto !== entry.valor ? <small className="vat-detail">Bruto {formatCurrency(entry.valorBruto)} · IVA {formatCurrency(entry.iva ?? 0)} ({formatPercentage(entry.taxaIva ?? 0)})</small> : null}</td><td><span className={`revenue-type revenue-type--${entry.tipo.toLowerCase()}`}>{entry.tipo}</span></td><td className="mono">{entry.ref}</td><td className="mono align-right">{formatCurrency(entry.valor)}</td></tr>)}</tbody></table></Card>

      <Modal open={entryOpen} onClose={() => setEntryOpen(false)} title="Novo lançamento" description="Regista um movimento para atualizar os KPIs de receita.">
        <form onSubmit={(event) => { event.preventDefault(); void handleEntry(new FormData(event.currentTarget)); }} className="form-stack"><div className="form-grid"><label>Empresa<select name="empresa" required autoFocus>{companies.map((company) => <option key={company}>{company}</option>)}</select></label><label>Data<input name="data" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label></div><div className="form-grid form-grid--3"><label>Tipo<select name="tipo"><option>Contratualizado</option><option>Faturado</option><option>Recebido</option></select></label><label>Valor sem IVA<input name="valor" type="number" step="0.01" min="0" required /></label><label>Referência<input name="ref" placeholder="FT 2026/…" /></label></div><label>Descrição<input name="descricao" required /></label>{entryError ? <div className="auth-error">{entryError}</div> : null}<div className="modal__actions"><Button type="button" variant="secondary" onClick={() => setEntryOpen(false)}>Cancelar</Button><Button type="submit">Guardar lançamento</Button></div></form>
      </Modal>
    </div>
  );
}
