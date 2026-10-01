import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Building2, CalendarDays, Check, CircleDollarSign, Mail, Phone, Save, ShieldCheck, ShieldOff, UserRound } from "lucide-react";
import { stageLabels } from "../data/seed";
import { formatCurrency, formatDecimal } from "../lib/format";
import { useRevenueData } from "../hooks/use-revenue-data";
import { useCRM } from "../state/crm-context";
import type { Lead, Opportunity, OutreachLegalBasis } from "../types";
import { Avatar, Button, Card, EmptyState, PageHeader, StageChip } from "../components/ui";

function daysBetween(start?: string, end?: string) {
  if (!start || !end) return null;
  const days = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;
  return Number.isFinite(days) && days >= 0 ? days : null;
}

function dateTimeLocalValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

interface OutreachComplianceInput {
  legalBasis?: OutreachLegalBasis;
  consentAt?: string;
  consentSource?: string;
  legalBasisEvidence?: string;
  legitimateInterestPurpose?: string;
  liaReference?: string;
  legitimateInterestExpiresAt?: string;
  optout?: boolean;
}

function ContactOutreachEditor({ contact, canManage, onSave }: { contact: Lead; canManage: boolean; onSave: (id: string, input: OutreachComplianceInput) => Promise<void> }) {
  const [basis, setBasis] = useState<OutreachLegalBasis | "">(contact.outreachLegalBasis ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const consentLocal = String(form.get("consentAt") ?? "").trim();
    const expiryLocal = String(form.get("legitimateInterestExpiresAt") ?? "").trim();
    setSaving(true); setSaved(false); setError("");
    try {
      await onSave(contact.id, {
        legalBasis: basis || undefined,
        consentAt: basis === "consent" && consentLocal ? new Date(consentLocal).toISOString() : undefined,
        consentSource: basis === "consent" ? String(form.get("consentSource") ?? "").trim() : undefined,
        legalBasisEvidence: basis === "contract" ? String(form.get("legalBasisEvidence") ?? "").trim() : undefined,
        legitimateInterestPurpose: basis === "legitimate_interest" ? String(form.get("legitimateInterestPurpose") ?? "").trim() : undefined,
        liaReference: basis === "legitimate_interest" ? String(form.get("liaReference") ?? "").trim() : undefined,
        legitimateInterestExpiresAt: basis === "legitimate_interest" && expiryLocal ? new Date(expiryLocal).toISOString() : undefined,
        optout: contact.optout || form.get("optout") === "on",
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1_800);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível atualizar a elegibilidade.");
    } finally {
      setSaving(false);
    }
  }

  return <form className="contact-compliance" onSubmit={(event) => void submit(event)}>
    <div className="contact-compliance__heading"><span><ShieldCheck size={14} />Elegibilidade Outreach</span>{saved ? <small className="positive" role="status">Guardado</small> : null}</div>
    <label>Base legal<select name="legalBasis" value={basis} disabled={!canManage} onChange={(event) => setBasis(event.target.value as OutreachLegalBasis | "")}><option value="">Sem base registada — bloqueado</option><option value="legitimate_interest">Interesse legítimo documentado</option><option value="consent">Consentimento</option><option value="contract">Execução de contrato</option><option value="not_applicable">Não aplicável — bloqueado</option></select></label>
    {basis === "consent" ? <div className="contact-compliance__consent"><label>Data do consentimento<input name="consentAt" type="datetime-local" required disabled={!canManage} defaultValue={dateTimeLocalValue(contact.outreachConsentAt)} /></label><label>Origem / prova<input name="consentSource" required disabled={!canManage} maxLength={500} defaultValue={contact.outreachConsentSource ?? ""} placeholder="Ex.: formulário do evento, 12/09/2026" /></label></div> : null}
    {basis === "contract" ? <label>Referência documental<input name="legalBasisEvidence" required disabled={!canManage} maxLength={500} defaultValue={contact.outreachLegalBasisEvidence ?? ""} placeholder="Ex.: contrato CRM-2026-041, cláusula 3" /></label> : null}
    {basis === "legitimate_interest" ? <div className="contact-compliance__consent"><label>Finalidade<input name="legitimateInterestPurpose" required disabled={!canManage} maxLength={500} defaultValue={contact.outreachLegitimateInterestPurpose ?? ""} placeholder="Ex.: prospeção B2B para otimização industrial" /></label><label>Referência da LIA<input name="liaReference" required disabled={!canManage} maxLength={500} defaultValue={contact.outreachLiaReference ?? ""} placeholder="Ex.: LIA-2026-07" /></label><label>Válida até<input name="legitimateInterestExpiresAt" type="datetime-local" required disabled={!canManage} defaultValue={dateTimeLocalValue(contact.outreachLegitimateInterestExpiresAt)} /></label></div> : null}
    {contact.optout ? <p className="contact-compliance__blocked"><ShieldOff size={14} />Suprimido globalmente. A remoção tem de ser feita por um administrador em Deliverability.</p> : <label className="contact-compliance__optout"><input name="optout" type="checkbox" disabled={!canManage} />Bloquear futuras comunicações para este contacto</label>}
    {!canManage ? <p className="contact-compliance__help">Só administradores e campaign managers podem alterar estes dados de conformidade.</p> : null}
    {contact.outreachLegalBasisRecordedAt ? <p className="contact-compliance__help">Última validação: {new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(contact.outreachLegalBasisRecordedAt))}</p> : null}
    <p className="contact-compliance__help">Sem uma base legal válida, o contacto permanece inelegível. O worker confirma tudo novamente antes de enviar.</p>
    {error ? <p className="contact-compliance__error" role="alert">{error}</p> : null}
    <Button type="submit" variant="secondary" disabled={saving || !canManage}><Save size={14} />{saving ? "A guardar…" : "Guardar elegibilidade"}</Button>
  </form>;
}

export function CompanyPage() {
  const { companyId } = useParams({ from: "/empresas/$companyId" });
  const { leads, opportunities, activities, team, currentUserId, updateCompanyName, updateLead, updateLeadOutreachCompliance, updateOpportunity } = useCRM();
  const { entries: revenueEntries } = useRevenueData();
  const companyOpportunities = useMemo(() => opportunities.filter((item) => item.empresaId === companyId || item.id === companyId), [companyId, opportunities]);
  const opportunity = companyOpportunities[0];
  const resolvedCompanyId = opportunity?.empresaId ?? companyId;
  const contacts = leads.filter((lead) => lead.empresaId === resolvedCompanyId || (!lead.empresaId && lead.empresa === opportunity?.empresa));
  const companyActivities = activities.filter((item) => companyOpportunities.some((value) => value.id === item.oportunidadeId) || item.empresa === opportunity?.empresa);
  const billing = revenueEntries.filter((entry) => entry.empresaId === resolvedCompanyId || entry.empresa === opportunity?.empresa);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  if (!opportunity) return <div className="page"><PageHeader eyebrow="Empresa" title="Empresa não encontrada" description="A ficha pode ter sido arquivada ou eliminada." actions={<Link to="/pipeline"><Button variant="secondary"><ArrowLeft size={16} />Voltar ao pipeline</Button></Link>} /></div>;

  const owner = team.find((item) => item.id === opportunity.ownerId);
  const currentUser = team.find((item) => item.id === currentUserId);
  const canManageOutreachCompliance = currentUser?.role === "admin" || currentUser?.outreachRole === "campaign_manager";
  const meetingDays = daysBetween(opportunity.dataPrimeiroContacto, opportunity.dataReuniao);
  const invoiced = billing.filter((entry) => entry.tipo === "Faturado").reduce((sum, entry) => sum + entry.valor, 0);
  const contracted = billing.filter((entry) => entry.tipo === "Contratualizado").reduce((sum, entry) => sum + entry.valor, 0);

  async function save(formData: FormData) {
    const companyName = String(formData.get("empresa") ?? "").trim();
    const evaluationValue = String(formData.get("avaliacao") ?? "");
    const proposalPriceValue = String(formData.get("valorProposta") ?? "");
    setSaving(true);
    setSaveError("");
    const changes: Partial<Opportunity> = {
      titulo: String(formData.get("titulo") ?? ""),
      valor: Number(formData.get("valor") ?? 0),
      recorrenteAnual: Number(formData.get("recorrente") ?? 0),
      valorProposta: proposalPriceValue ? Number(proposalPriceValue) : undefined,
      ownerId: String(formData.get("ownerId") ?? opportunity.ownerId),
      dataPrimeiroContacto: String(formData.get("primeiroContacto") ?? ""),
      dataReuniao: String(formData.get("reuniao") ?? ""),
      dataProposta: String(formData.get("proposta") ?? ""),
      dataPiloto: String(formData.get("piloto") ?? ""),
      dataFecho: String(formData.get("fecho") ?? ""),
      dataFechoPrevista: String(formData.get("fechoPrevisto") ?? ""),
      cicloAcordoMeses: Number(formData.get("cicloAcordoMeses") ?? 0) || undefined,
      avaliacao: evaluationValue ? Number(evaluationValue) : undefined,
      notas: String(formData.get("notas") ?? ""),
    };
    try {
      if (companyName !== opportunity.empresa) await updateCompanyName(resolvedCompanyId, companyName);
      updateOpportunity(opportunity.id, changes);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível guardar o nome da empresa.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Ficha de empresa" title={opportunity.empresa} description="Dados comerciais, contactos, faturação e marcos do sales cycle numa única ficha." actions={<><Link to="/pipeline"><Button variant="secondary"><ArrowLeft size={16} />Pipeline</Button></Link><StageChip stage={opportunity.estado} /></>} />
      <section className="company-summary-grid">
        <Card><span><Building2 size={16} />Estado atual</span><strong>{stageLabels[opportunity.estado]}</strong><small>{companyOpportunities.length} oportunidade{companyOpportunities.length === 1 ? "" : "s"}</small></Card>
        <Card><span><CircleDollarSign size={16} />Contratualizado</span><strong className="mono">{formatCurrency(contracted || opportunity.valor)}</strong><small>valor registado</small></Card>
        <Card><span><CircleDollarSign size={16} />Faturado sem IVA</span><strong className="mono">{formatCurrency(invoiced)}</strong><small>{billing.filter((entry) => entry.tipo === "Faturado").length} movimento(s)</small></Card>
        <Card><span><CalendarDays size={16} />Ciclo até acordo verbal</span><strong className="mono">{opportunity.cicloAcordoMeses == null ? "Sem amostra" : `${formatDecimal(opportunity.cicloAcordoMeses)} ${opportunity.cicloAcordoMeses === 1 ? "mês" : "meses"}`}</strong><small>{meetingDays === null ? "Reunião sem intervalo completo" : `${formatDecimal(meetingDays)} dias até reunião`}</small></Card>
      </section>

      <section className="company-layout">
        <Card className="company-form-card">
          <div className="panel-header"><div><p className="eyebrow">Tudo editável</p><h2>Dados comerciais</h2></div>{saved ? <span className="saved-label"><Check size={15} />Guardado</span> : null}</div>
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void save(new FormData(event.currentTarget)); }}>
            <label>Nome da empresa<input name="empresa" required maxLength={160} defaultValue={opportunity.empresa} /></label>
            <div className="form-grid"><label>Oportunidade<input name="titulo" defaultValue={opportunity.titulo} /></label><label>Responsável<select name="ownerId" defaultValue={opportunity.ownerId}>{team.map((item) => <option value={item.id} key={item.id}>{item.nome}</option>)}</select></label></div>
            <div className="form-grid"><label>Valor contratado / estimado<input className="mono" name="valor" type="number" min="0" step="0.01" defaultValue={opportunity.valor} /></label><label>Preço da proposta (0 se não houve)<input className="mono" name="valorProposta" type="number" min="0" step="0.01" defaultValue={opportunity.valorProposta ?? (opportunity.estado === "perdido" ? 0 : "")} /></label></div>
            <div className="form-grid"><label>Recorrente anual<input className="mono" name="recorrente" type="number" min="0" step="0.01" defaultValue={opportunity.recorrenteAnual ?? 0} /></label><label>Avaliação do cliente (1–5)<input name="avaliacao" type="number" min="1" max="5" defaultValue={opportunity.avaliacao ?? ""} /></label></div>
            <h3 className="settings-subtitle">Marcos comerciais</h3>
            <div className="milestone-grid">
              <label>Ciclo: 1.º contacto → acordo verbal (meses)<input className="mono" name="cicloAcordoMeses" type="number" min="0" max="240" step="0.01" defaultValue={opportunity.cicloAcordoMeses ?? ""} placeholder="Ex.: 2" /></label>
              <label>Primeiro contacto<input name="primeiroContacto" type="date" defaultValue={opportunity.dataPrimeiroContacto} /></label>
              <label>Reunião realizada<input name="reuniao" type="date" defaultValue={opportunity.dataReuniao} /></label>
              <label>Piloto iniciado<input name="piloto" type="date" defaultValue={opportunity.dataPiloto} /></label>
              <label>Proposta enviada<input name="proposta" type="date" defaultValue={opportunity.dataProposta} /></label>
              <label>Cliente desde / fecho administrativo<input name="fecho" type="date" defaultValue={opportunity.dataFecho} /></label>
              <label>Fecho previsto<input name="fechoPrevisto" type="date" defaultValue={opportunity.dataFechoPrevista} /></label>
            </div>
            <label>Notas internas<textarea name="notas" rows={5} defaultValue={opportunity.notas} placeholder="Contexto, próximos passos, riscos e informação do projeto." /></label>
            {saveError ? <div className="auth-error" role="alert">{saveError}</div> : null}
            <div className="modal__actions"><Button type="submit" disabled={saving}><Save size={16} />{saving ? "A guardar…" : "Guardar ficha"}</Button></div>
          </form>
        </Card>

        <div className="company-side-stack">
          <Card>
            <div className="panel-header"><div><p className="eyebrow">Pessoas</p><h2>Contactos</h2></div><Avatar ownerId={opportunity.ownerId} size="sm" /></div>
            <div className="company-contact-list">{contacts.map((contact) => <div id={`contact-${contact.id}`} className="company-contact-record" key={contact.id}><div className="company-contact-record__identity"><span className="company-monogram">{contact.nome.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><input value={contact.nome} aria-label="Nome" onChange={(event) => updateLead(contact.id, "nome", event.target.value)} /><small><Mail size={12} />{contact.email || "Sem email"}</small><small><Phone size={12} />{contact.telefone || "Sem telefone"}</small></span></div><ContactOutreachEditor contact={contact} canManage={canManageOutreachCompliance} onSave={updateLeadOutreachCompliance} /></div>)}</div>
          </Card>
          <Card>
            <div className="panel-header"><div><p className="eyebrow">Timeline real</p><h2>Atividade</h2></div><span className="counter">{companyActivities.length}</span></div>
            {companyActivities.length ? <div className="timeline">{companyActivities.slice(0, 12).map((activity) => <div className="timeline__item" key={activity.id}><span className={`timeline-icon timeline-icon--${activity.tipo}`}><UserRound size={13} /></span><div><strong>{activity.descricao}</strong><span>{new Date(activity.data).toLocaleString("pt-PT", { dateStyle: "medium", timeStyle: "short" })}{activity.reuniaoInferida ? " · sinal de reunião por confirmar" : ""}</span></div></div>)}</div> : <EmptyState>Sem atividade sincronizada para esta empresa.</EmptyState>}
          </Card>
          <Card>
            <div className="panel-header"><div><p className="eyebrow">Movimentos</p><h2>Faturação</h2></div><Link to="/faturacao" className="panel-link">Editar</Link></div>
            {billing.length ? <div className="billing-mini-list">{billing.map((entry) => <div key={entry.id}><span><strong>{entry.tipo}</strong><small>{entry.data} · {entry.descricao}</small></span><b className="mono">{formatCurrency(entry.valor)}</b></div>)}</div> : <EmptyState>Sem faturação registada.</EmptyState>}
          </Card>
        </div>
      </section>
    </div>
  );
}
