import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, ExternalLink, Plus, Search, ShieldCheck, UsersRound, X } from "lucide-react";
import { Button } from "../../../components/ui";
import { stageLabels } from "../../../data/seed";
import { useCRM } from "../../../state/crm-context";
import { EligibilityBadge, EmptyPanel, formatNumber, ModuleDialog, OutreachError, OutreachLoading, OutreachPageHeader } from "../components";
import { useAddRecipients, useAttachAudienceToCampaign, useAudiences, useCampaigns, useCreateAudience, useEligibility, useVerificationProvider, useVerifyLeads, type LeadVerificationResult } from "../hooks";

type EligibilityFilter = "all" | "eligible" | "blocked";
const verificationLabels = { valid: "Válido", verified: "Válido", invalid: "Inválido", risky: "Arriscado", catch_all: "Catch-all", pending: "Pendente", unknown: "Inconclusivo" } as const;

export function OutreachAudiencesPage() {
  const { leads, team } = useCRM();
  const audiences = useAudiences();
  const campaigns = useCampaigns();
  const addRecipients = useAddRecipients();
  const attachAudience = useAttachAudienceToCampaign();
  const createAudience = useCreateAudience();
  const verificationProvider = useVerificationProvider();
  const verifyLeads = useVerifyLeads();
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [eligibilityFilter, setEligibilityFilter] = useState<EligibilityFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [verifySelected, setVerifySelected] = useState<Set<string>>(new Set());
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [verificationResults, setVerificationResults] = useState<LeadVerificationResult[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const searched = useMemo(() => leads.filter((lead) => {
    const matchesText = `${lead.nome} ${lead.empresa} ${lead.email} ${lead.cargo}`.toLowerCase().includes(deferredQuery.toLowerCase().trim());
    return matchesText && (owner === "all" || lead.ownerId === owner);
  }), [deferredQuery, leads, owner]);
  const idsForEvaluation = useMemo(() => searched.map((lead) => lead.id), [searched]);
  const eligibility = useEligibility(idsForEvaluation);
  const eligibilityMap = useMemo(() => new Map((eligibility.data?.items ?? []).map((item) => [item.contactId, item])), [eligibility.data]);
  const filtered = searched.filter((lead) => {
    const item = eligibilityMap.get(lead.id);
    const isEligible = Boolean(item?.eligible && !lead.optout);
    if (eligibilityFilter === "eligible") return isEligible;
    if (eligibilityFilter === "blocked") return item ? !isEligible : false;
    return true;
  });
  const eligibleVisible = filtered.filter((lead) => eligibilityMap.get(lead.id)?.eligible && !lead.optout);
  const verifiableVisible = filtered.filter((lead) => Boolean(lead.email) && !lead.optout);

  if (audiences.isLoading) return <OutreachLoading label="A preparar audiências…" />;
  if (audiences.isError) return <OutreachError error={audiences.error} retry={() => void audiences.refetch()} />;

  function toggleAll(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      eligibleVisible.forEach((lead) => checked ? next.add(lead.id) : next.delete(lead.id));
      return next;
    });
  }

  function toggleVerifiable(checked: boolean) {
    setVerifySelected(checked ? new Set(verifiableVisible.slice(0, 25).map((lead) => lead.id)) : new Set());
  }

  async function handleVerify() {
    try {
      setVerificationResults((await verifyLeads.mutateAsync([...verifySelected])).items);
      setSelected(new Set());
    } catch {
      /* Keep the selection and dialog open for a retry. */
    }
  }

  async function handleAudience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const destination = String(form.get("destination") ?? "");
    try {
      let audienceId = destination.startsWith("audience:") ? destination.slice("audience:".length) : "";
      if (!audienceId) {
        const name = String(form.get("name") ?? "").trim() || `Segmento ${new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium" }).format(new Date())}`;
        const created = await createAudience.mutateAsync({ name, description: "Criada a partir da base canónica do CRM", contactIds: [...selected] });
        audienceId = created.id;
      }
      await addRecipients.mutateAsync({ audienceId, contactIds: [...selected] });
      if (destination.startsWith("campaign:")) await attachAudience.mutateAsync({ campaignId: destination.slice("campaign:".length), audienceId });
      setSelected(new Set()); setDialogOpen(false);
    } catch {
      /* Keep the selection and dialog intact so the user can retry safely. */
    }
  }

  return <div className="outreach-page">
    <OutreachPageHeader eyebrow="Contactos canónicos" title="Audiências" description="Segmenta contactos do CRM. Identidade e propriedade continuam a ser editadas exclusivamente na ficha CRM." actions={<><Button variant="secondary" disabled={!verifySelected.size} onClick={() => { setVerificationResults(null); setVerificationOpen(true); }}><ShieldCheck size={15} />Verificar {verifySelected.size || ""} leads</Button><Button disabled={!selected.size} onClick={() => setDialogOpen(true)}><Plus size={15} />Adicionar {selected.size || ""} a audiência ou campanha</Button></>} />
    <section className="outreach-audience-summary">
      <div><strong>{formatNumber(leads.length)}</strong><span>contactos no CRM</span></div><div><strong>{formatNumber(audiences.data?.items.length ?? 0)}</strong><span>audiências guardadas</span></div><p><AlertTriangle size={15} />Elegibilidade é apenas uma pré-análise. Antes do envio, o worker volta a validar email atual, base legal, verificação, suppression, resposta e quota.</p>
    </section>
    <div className="outreach-audience-toolbar">
      <label className="outreach-search"><Search size={15} /><span className="sr-only">Pesquisar contactos</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, empresa, email ou cargo…" /></label>
      <label><span className="sr-only">Responsável</span><select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="all">Todos os responsáveis</option>{team.map((member) => <option value={member.id} key={member.id}>{member.nome}</option>)}</select></label>
      <div className="outreach-segmented" role="group" aria-label="Filtrar elegibilidade">{(["all", "eligible", "blocked"] as const).map((value) => <button key={value} type="button" aria-pressed={eligibilityFilter === value} onClick={() => setEligibilityFilter(value)} className={eligibilityFilter === value ? "is-active" : ""}>{value === "all" ? "Todos" : value === "eligible" ? "Elegíveis" : "Bloqueados"}</button>)}</div>
    </div>
    {eligibility.isError ? <div className="outreach-inline-error" role="alert"><AlertTriangle size={15} />Não foi possível calcular elegibilidade. Nenhum contacto pode ser selecionado até a validação regressar. <button onClick={() => void eligibility.refetch()}>Repetir</button></div> : null}
    <section className="outreach-table-shell">
      <div className="outreach-table-scroll"><table className="outreach-table"><thead><tr><th><input type="checkbox" aria-label="Selecionar até 25 emails visíveis para verificação" title="Verificar emails" checked={verifiableVisible.length > 0 && verifiableVisible.slice(0, 25).every((lead) => verifySelected.has(lead.id))} onChange={(event) => toggleVerifiable(event.target.checked)} /><small>Verificar</small></th><th><input type="checkbox" aria-label="Selecionar contactos elegíveis visíveis para audiência" title="Adicionar a audiência" checked={eligibleVisible.length > 0 && eligibleVisible.every((lead) => selected.has(lead.id))} onChange={(event) => toggleAll(event.target.checked)} /><small>Audiência</small></th><th>Contacto</th><th>Empresa</th><th>Estado CRM</th><th>Responsável</th><th>Verificação</th><th>Elegibilidade</th><th><span className="sr-only">Ficha</span></th></tr></thead><tbody>{filtered.map((lead) => {
        const evaluation = eligibilityMap.get(lead.id);
        const eligible = Boolean(evaluation?.eligible && !lead.optout);
        const reasons = lead.optout ? ["Opt-out no CRM"] : evaluation?.reasons;
        return <tr key={lead.id}><td><input type="checkbox" aria-label={`Verificar email de ${lead.nome}`} disabled={!lead.email || lead.optout || (verifySelected.size >= 25 && !verifySelected.has(lead.id))} checked={verifySelected.has(lead.id)} onChange={(event) => setVerifySelected((current) => { const next = new Set(current); event.target.checked ? next.add(lead.id) : next.delete(lead.id); return next; })} /></td><td><input type="checkbox" aria-label={`Adicionar ${lead.nome} a audiência`} disabled={!eligible} checked={selected.has(lead.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(lead.id) : next.delete(lead.id); return next; })} /></td><td><span className="outreach-person"><b>{lead.nome}</b><small>{lead.email || "Sem email"} · {lead.cargo || "Cargo não definido"}</small></span></td><td>{lead.empresa}</td><td>{stageLabels[lead.estado]}</td><td>{team.find((member) => member.id === lead.ownerId)?.nome ?? "Sem responsável"}</td><td>{evaluation ? <span className={`outreach-eligibility ${evaluation.verification === "valid" || evaluation.verification === "verified" ? "is-eligible" : "is-blocked"}`}>{verificationLabels[evaluation.verification] ?? "Inconclusivo"}</span> : <span className="outreach-evaluating">A avaliar…</span>}</td><td>{evaluation || lead.optout ? <EligibilityBadge eligible={eligible} reasons={reasons} /> : <span className="outreach-evaluating">A avaliar…</span>}</td><td><Link to="/empresas/$companyId" params={{ companyId: lead.empresaId ?? lead.id }} hash={`contact-${lead.id}`} aria-label={`Abrir elegibilidade de ${lead.nome} na ficha CRM de ${lead.empresa}`}><ExternalLink size={15} /></Link></td></tr>;
      })}</tbody></table></div>
      {!filtered.length ? <EmptyPanel icon={<UsersRound size={22} />} title="Sem contactos neste segmento" description="Altera a pesquisa, o responsável ou o filtro de elegibilidade." /> : null}
      <footer><span>{formatNumber(filtered.length)} resultados · {formatNumber(eligibleVisible.length)} elegíveis visíveis · verificação em lotes de até 25</span>{verifySelected.size ? <span className="outreach-selection"><ShieldCheck size={14} />{verifySelected.size} para verificar <button onClick={() => setVerifySelected(new Set())} aria-label="Limpar seleção para verificação"><X size={14} /></button></span> : null}{selected.size ? <span className="outreach-selection"><Check size={14} />{selected.size} para audiência <button onClick={() => setSelected(new Set())} aria-label="Limpar seleção para audiência"><X size={14} /></button></span> : null}</footer>
    </section>

    <ModuleDialog open={verificationOpen} onClose={() => { if (!verifyLeads.isPending) setVerificationOpen(false); }} title="Verificar leads" description={`${verifySelected.size} endereços serão enviados à Instantly para confirmar a caixa. Esta ação pode consumir créditos. A verificação não concede, por si só, autorização para contactar.`}>
      <div className="outreach-verification-panel">
        {verificationProvider.isPending ? <p>A confirmar a integração…</p> : !verificationProvider.data?.configured ? <div className="outreach-inline-error" role="alert">A integração de verificação ainda não está configurada. É necessária uma chave API da Instantly com permissões de leitura e criação de verificações, e créditos disponíveis.</div> : null}
        {verificationResults ? <div className="outreach-verification-results" role="status"><p>{verificationResults.filter((item) => item.status === "valid").length} válidos · {verificationResults.filter((item) => item.status === "invalid").length} inválidos · {verificationResults.filter((item) => item.status === "catch_all").length} catch-all · {verificationResults.filter((item) => item.status === "pending" || item.status === "unknown").length} inconclusivos/pendentes</p><ul>{verificationResults.map((item) => <li key={item.contactId}><strong>{item.email ?? "Sem email"}</strong>: {item.reason}{item.cached ? " (resultado anterior)" : ""}</li>)}</ul></div> : null}
        {verifyLeads.isError ? <div className="outreach-inline-error" role="alert">{verifyLeads.error instanceof Error ? verifyLeads.error.message : "Não foi possível verificar os emails."}</div> : null}
        <footer><Button variant="secondary" disabled={verifyLeads.isPending} onClick={() => setVerificationOpen(false)}>Fechar</Button><Button disabled={!verificationProvider.data?.configured || verifyLeads.isPending || !verifySelected.size} onClick={() => void handleVerify()}>{verifyLeads.isPending ? "A verificar…" : verificationResults?.some((item) => item.status === "pending") ? "Atualizar pendentes" : "Confirmar verificação"}</Button></footer>
      </div>
    </ModuleDialog>

    <ModuleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Adicionar contactos" description={`${selected.size} contactos elegíveis serão associados por ID; os dados pessoais continuam no CRM.`}>
      <form className="outreach-form" onSubmit={(event) => void handleAudience(event)}>
        <label>Destino<select required name="destination" defaultValue={audiences.data?.items[0] ? `audience:${audiences.data.items[0].id}` : "new"}>{audiences.data?.items.length ? <optgroup label="Audiências existentes">{audiences.data.items.map((audience) => <option value={`audience:${audience.id}`} key={audience.id}>{audience.name} · {audience.contactCount} contactos</option>)}</optgroup> : null}<option value="new">+ Criar nova audiência</option>{campaigns.data?.items.length ? <optgroup label="Adicionar diretamente a campanha">{campaigns.data.items.filter((campaign) => campaign.status !== "completed" && campaign.status !== "archived").map((campaign) => <option value={`campaign:${campaign.id}`} key={campaign.id}>{campaign.name} · {campaign.status}</option>)}</optgroup> : null}</select></label>
        <label>Nome do novo segmento<input name="name" placeholder="Usado ao criar audiência ou ao adicionar a campanha" /></label>
        {(addRecipients.isError || createAudience.isError || attachAudience.isError) ? <div className="outreach-inline-error" role="alert">{(addRecipients.error ?? createAudience.error ?? attachAudience.error) instanceof Error ? (addRecipients.error ?? createAudience.error ?? attachAudience.error)?.message : "Não foi possível atualizar o destino."}</div> : null}
        <footer><Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" disabled={addRecipients.isPending || createAudience.isPending || attachAudience.isPending}>{addRecipients.isPending || createAudience.isPending || attachAudience.isPending ? "A validar…" : "Adicionar contactos"}</Button></footer>
      </form>
    </ModuleDialog>
  </div>;
}
