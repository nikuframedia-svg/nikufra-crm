import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FlaskConical, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui";
import { formatDateTime, ModuleDialog } from "../components";
import { outreachKeys, useCampaignMessageTests, useEligibility, useMailboxAction, useMessageTestContacts, useQueueCampaignMessageTest, useSaveCampaignSteps, useSettings, type CampaignStepDraft } from "../hooks";
import type { CampaignDetail, SequenceStep } from "../types";

function toDraft(sequence: SequenceStep[]): CampaignStepDraft[] {
  return [...sequence].sort((a, b) => a.order - b.order).map((step) => ({
    kind: step.kind, delayMinutes: step.delayMinutes, replyToPrevious: step.replyToPrevious,
    active: step.active,
    variants: step.variants.map((variant) => ({ name: variant.name, weight: variant.weight, subject: variant.subject, body: variant.body, active: variant.active })),
  }));
}

function newEmail(): CampaignStepDraft {
  return { kind: "email", delayMinutes: 2_880, replyToPrevious: true, active: true, variants: [{ name: "A", weight: 100, subject: "", body: "", active: true }] };
}

function delayLabel(minutes: number) {
  if (!minutes) return "Sem espera";
  if (minutes % 1_440 === 0) return `${minutes / 1_440} dia${minutes === 1_440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} horas`;
  return `${minutes} minutos`;
}

function mailboxStatus(mailbox: CampaignDetail["availableMailboxes"][number]) {
  if (mailbox.provider !== "google") return "Este fornecedor ainda não permite o envio de testes.";
  if (mailbox.status !== "active") return "Conta desligada. Volta a ligá-la em Mailboxes.";
  if (!mailbox.sendEnabled) return "Envio desativado para esta conta.";
  if (mailbox.ready) return "Pronta para envio.";
  if (!mailbox.dnsCheckedAt) return "DNS ainda sem verificação.";
  if (Date.now() - new Date(mailbox.dnsCheckedAt).getTime() >= 86_400_000) return `Última verificação DNS em ${formatDateTime(mailbox.dnsCheckedAt)}; é preciso renovar.`;
  return "A última verificação DNS não passou. Revê os registos antes de enviar.";
}

export function CampaignSequenceSection({ campaign, canManage, canTest }: { campaign: CampaignDetail; canManage: boolean; canTest: boolean }) {
  const queryClient = useQueryClient();
  const saved = useMemo(() => toDraft(campaign.sequence), [campaign.sequence]);
  const [draft, setDraft] = useState<CampaignStepDraft[]>(saved);
  const [editing, setEditing] = useState(false);
  const [testTarget, setTestTarget] = useState<{ stepId: string; variantId: string; subject: string } | null>(null);
  const [search, setSearch] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [contactId, setContactId] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [testCampaignId, setTestCampaignId] = useState("");
  const [testKey, setTestKey] = useState(() => crypto.randomUUID());
  const save = useSaveCampaignSteps(campaign.id);
  const test = useQueueCampaignMessageTest(campaign.id);
  const messageTests = useCampaignMessageTests(campaign.id, canTest);
  const contacts = useMessageTestContacts(campaign.id, committedSearch, Boolean(testTarget));
  const settings = useSettings(Boolean(testTarget));
  const dnsCheck = useMailboxAction();
  const eligibility = useEligibility(contactId ? [contactId] : []);
  const choices = contacts.data?.items ?? [];
  const selectedLead = choices.find((lead) => lead.id === contactId);
  const contactEligible = Boolean(eligibility.data?.items.find((item) => item.contactId === contactId)?.eligible && selectedLead);
  const selectedMailboxes = campaign.availableMailboxes.filter((item) => item.selected);
  const readyMailboxes = selectedMailboxes.filter((item) => item.ready);
  const outboundReady = Boolean(settings.data?.outboundEnabled);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const canEdit = canManage && campaign.status === "draft";

  useEffect(() => { setDraft(saved); }, [saved]);
  useEffect(() => {
    const timer = window.setTimeout(() => setCommittedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (testTarget && readyMailboxes.length && !readyMailboxes.some((item) => item.id === mailboxId)) setMailboxId(readyMailboxes[0].id);
  }, [mailboxId, readyMailboxes, testTarget]);

  function changeStep(index: number, update: (step: CampaignStepDraft) => CampaignStepDraft) {
    setDraft((current) => current.map((step, at) => at === index ? update(step) : step));
  }

  function moveStep(index: number, distance: number) {
    setDraft((current) => {
      const next = [...current];
      [next[index], next[index + distance]] = [next[index + distance]!, next[index]!];
      return next;
    });
  }

  async function saveSteps(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await save.mutateAsync(draft); setEditing(false); } catch { /* Keep edits visible. */ }
  }

  function openTest(stepId: string, variantId: string, subject: string) {
    void queryClient.invalidateQueries({ queryKey: outreachKeys.campaign(campaign.id) });
    setTestTarget({ stepId, variantId, subject });
    setSearch(""); setCommittedSearch(""); setContactId(""); setMailboxId(readyMailboxes[0]?.id ?? "");
    setConfirmed(false); setTestCampaignId(""); setTestKey(crypto.randomUUID()); test.reset();
  }

  async function sendTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!testTarget || !contactEligible || !confirmed || !mailboxId || !outboundReady) return;
    try {
      const result = await test.mutateAsync({ stepId: testTarget.stepId, variantId: testTarget.variantId, contactId, mailboxId, idempotencyKey: testKey });
      setTestCampaignId(result.id);
    } catch { /* Show the backend guardrail error in the dialog. */ }
  }

  return <section className="outreach-panel outreach-campaign-sequence">
    <header><div><h3>Mensagens da campanha</h3><p>Define a ordem, o intervalo e o conteúdo de cada email.</p></div><span>{campaign.sequence.length} passos</span></header>
    {canEdit ? <div className="outreach-sequence-actions"><Button variant="secondary" onClick={() => setEditing((value) => !value)}>{editing ? "Fechar edição" : "Editar mensagens"}</Button></div> : null}
    {editing && canEdit ? <form className="outreach-sequence-editor" onSubmit={(event) => void saveSteps(event)}>
      {draft.map((step, index) => <fieldset key={index} className="outreach-sequence-step"><legend>Passo {index + 1} · {step.kind === "email" ? "Email" : "Espera"}</legend>
        <div className="outreach-sequence-step-tools">
          <button type="button" aria-label={`Subir passo ${index + 1}`} disabled={index === 0} onClick={() => moveStep(index, -1)}><ArrowUp size={15} /></button>
          <button type="button" aria-label={`Descer passo ${index + 1}`} disabled={index === draft.length - 1} onClick={() => moveStep(index, 1)}><ArrowDown size={15} /></button>
          <button type="button" aria-label={`Remover passo ${index + 1}`} onClick={() => setDraft((current) => current.filter((_, at) => at !== index))}><Trash2 size={15} /></button>
        </div>
        <div className="outreach-sequence-fields"><label>Espera antes deste passo (horas)<input type="number" min={0} max={8760} step={0.5} value={step.delayMinutes / 60} onChange={(event) => changeStep(index, (current) => ({ ...current, delayMinutes: Math.round(Number(event.target.value) * 60) }))} /></label>
          <label className="outreach-check-row"><input type="checkbox" checked={step.active} onChange={(event) => changeStep(index, (current) => ({ ...current, active: event.target.checked }))} />Passo ativo</label>
          {step.kind === "email" ? <label className="outreach-check-row"><input type="checkbox" checked={step.replyToPrevious} onChange={(event) => changeStep(index, (current) => ({ ...current, replyToPrevious: event.target.checked }))} />Responder na conversa anterior</label> : null}
        </div>
        {step.kind === "email" ? <div className="outreach-sequence-variants">{step.variants.map((variant, variantIndex) => <div className="outreach-sequence-variant" key={variantIndex}>
          <div className="outreach-sequence-variant-head"><strong>Variante {variant.name}</strong>{step.variants.length > 1 ? <button type="button" onClick={() => changeStep(index, (current) => ({ ...current, variants: current.variants.filter((_, at) => at !== variantIndex) }))}>Remover variante</button> : null}</div>
          <div className="outreach-sequence-fields"><label>Nome<input required maxLength={40} value={variant.name} onChange={(event) => changeStep(index, (current) => ({ ...current, variants: current.variants.map((item, at) => at === variantIndex ? { ...item, name: event.target.value } : item) }))} /></label><label>Peso relativo<input required type="number" min={0} max={10000} value={variant.weight} onChange={(event) => changeStep(index, (current) => ({ ...current, variants: current.variants.map((item, at) => at === variantIndex ? { ...item, weight: Number(event.target.value) } : item) }))} /></label><label className="outreach-check-row"><input type="checkbox" checked={variant.active} onChange={(event) => changeStep(index, (current) => ({ ...current, variants: current.variants.map((item, at) => at === variantIndex ? { ...item, active: event.target.checked } : item) }))} />Variante ativa</label></div>
          <label>Assunto<input required maxLength={998} value={variant.subject} onChange={(event) => changeStep(index, (current) => ({ ...current, variants: current.variants.map((item, at) => at === variantIndex ? { ...item, subject: event.target.value } : item) }))} /></label>
          <label>Mensagem<textarea required rows={7} value={variant.body} onChange={(event) => changeStep(index, (current) => ({ ...current, variants: current.variants.map((item, at) => at === variantIndex ? { ...item, body: event.target.value } : item) }))} /></label>
        </div>)}{step.variants.length < 10 ? <Button type="button" variant="ghost" onClick={() => changeStep(index, (current) => ({ ...current, variants: [...current.variants, { name: String.fromCharCode(65 + current.variants.length), weight: 100, subject: "", body: "", active: true }] }))}><Plus size={14} />Adicionar variante</Button> : null}</div> : null}
      </fieldset>)}
      <div className="outreach-sequence-add"><Button type="button" variant="secondary" disabled={draft.length >= 50} onClick={() => setDraft((current) => [...current, { ...newEmail(), delayMinutes: current.length ? 2_880 : 0 }])}><Plus size={14} />Adicionar email</Button><Button type="button" variant="secondary" disabled={draft.length >= 50} onClick={() => setDraft((current) => [...current, { kind: "wait", delayMinutes: 2_880, replyToPrevious: true, active: true, variants: [] }])}>Adicionar espera</Button></div>
      {save.isError ? <p className="outreach-inline-error" role="alert">{save.error instanceof Error ? save.error.message : "Não foi possível guardar a sequência."}</p> : null}
      <footer><span>{dirty ? "Alterações por guardar. Os testes usam apenas mensagens guardadas." : "Sem alterações por guardar."}</span><Button type="submit" disabled={!dirty || !draft.length || save.isPending}><Save size={14} />{save.isPending ? "A guardar…" : "Guardar sequência"}</Button></footer>
    </form> : null}
    <div className="outreach-sequence">{campaign.sequence.length ? [...campaign.sequence].sort((a, b) => a.order - b.order).map((step) => <article key={step.id}><span>{step.order}</span><div><strong>{step.kind === "wait" ? `Esperar ${delayLabel(step.delayMinutes)}` : `${step.variants[0]?.subject || "Email sem assunto"}${step.active ? "" : " · Inativo"}`}</strong><p>{step.kind === "wait" ? "O próximo passo respeita a janela de envio e a quota." : `${step.variants.length} variante${step.variants.length === 1 ? "" : "s"} · ${delayLabel(step.delayMinutes)} antes deste passo`}</p>{step.kind === "email" && canTest ? <div className="outreach-message-test-actions">{step.variants.filter((variant) => variant.active && step.active).map((variant) => <Button key={variant.id} variant="ghost" disabled={dirty} onClick={() => openTest(step.id, variant.id, variant.subject)}><FlaskConical size={14} />Testar envio{step.variants.length > 1 ? ` · ${variant.name}` : ""}</Button>)}</div> : null}</div></article>) : <p className="outreach-panel-empty">Ainda não existem mensagens na sequência. Adiciona a primeira mensagem no editor.</p>}</div>
    {canTest && ((messageTests.data?.items ?? []).length || messageTests.isError) ? <div className="outreach-message-tests"><h4>Testes de envio</h4>{messageTests.isError ? <p className="outreach-inline-error" role="alert">Não foi possível carregar o histórico dos testes.</p> : null}{messageTests.data?.items?.map((item) => <Link key={item.id} to="/outreach/campanhas/$campaignId" params={{ campaignId: item.id }}><span><strong>{item.recipientEmail || "Destinatário removido"}</strong><small>{item.mailboxEmail || "Remetente removido"} · {formatDateTime(item.createdAt)}</small></span><span>{item.sentCount ? "Enviado pelo Gmail" : item.jobStatus === "pending" || item.jobStatus === "leased" ? "Em fila" : item.jobStatus === "reconciliation_required" ? "A reconciliar" : item.jobStatus === "cancelled" ? "Bloqueado" : item.jobStatus || item.status}{item.lastError ? <small>{item.lastError}</small> : null}</span></Link>)}</div> : null}

    <ModuleDialog open={Boolean(testTarget)} onClose={() => { if (!test.isPending) setTestTarget(null); }} title="Testar envio da mensagem" description="Envia um email real a um destinatário desta campanha. O teste usa uma campanha individual e respeita os bloqueios de envio.">
      {testCampaignId ? <div className="outreach-test-result" role="status"><strong>Teste colocado em fila</strong><p>O worker enviará dentro da janela e quota disponíveis. A aceitação pelo Gmail não confirma chegada à caixa de entrada.</p><Link to="/outreach/campanhas/$campaignId" params={{ campaignId: testCampaignId }}>Ver estado do teste</Link></div> : <form className="outreach-form" onSubmit={(event) => void sendTest(event)}>
        <p><strong>Mensagem:</strong> {testTarget?.subject}</p>
        <label>Pesquisar destinatário da campanha<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setContactId(""); }} placeholder="Nome, email ou empresa" /></label>
        <label>Destinatário<select required value={contactId} disabled={contacts.isLoading || contacts.isError || !choices.length} onChange={(event) => { setContactId(event.target.value); setTestKey(crypto.randomUUID()); }}><option value="">{contacts.isLoading ? "A carregar destinatários da campanha…" : choices.length ? "Seleciona um destinatário…" : search.trim() ? "Nenhum destinatário corresponde à pesquisa" : "Esta campanha não tem destinatários"}</option>{choices.map((lead) => <option key={lead.id} value={lead.id}>{lead.name} · {lead.email} · {lead.companyName}</option>)}</select></label>
        {contacts.isError ? <p className="outreach-inline-error" role="alert">Não foi possível consultar os destinatários da campanha. {contacts.error instanceof Error ? contacts.error.message : "Tenta novamente."}</p> : null}
        {!contacts.isLoading && !contacts.isError ? <p className="outreach-field-help">A mostrar até 30 destinatários desta campanha. Pesquisa para encontrar outro destinatário da lista.</p> : null}
        {contactId && eligibility.isLoading ? <p className="outreach-field-help">A verificar elegibilidade…</p> : null}
        {contactId && eligibility.isError ? <p className="outreach-inline-error" role="alert">Não foi possível confirmar a elegibilidade. {eligibility.error instanceof Error ? eligibility.error.message : "Tenta novamente."}</p> : null}
        {contactId && !contactEligible && !eligibility.isLoading && !eligibility.isError ? <p className="outreach-inline-error" role="alert">Este contacto não está apto para o teste: {(eligibility.data?.items.find((item) => item.contactId === contactId)?.reasons ?? ["sem verificação disponível"]).join(" · ")}.</p> : null}
        <label>Remetente<select required value={mailboxId} disabled={!readyMailboxes.length} onChange={(event) => { setMailboxId(event.target.value); setTestKey(crypto.randomUUID()); }}><option value="">Seleciona uma mailbox pronta…</option>{selectedMailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id} disabled={!mailbox.ready}>{mailbox.displayName || mailbox.email} · {mailbox.email}{!mailbox.ready ? ` · ${mailbox.status !== "active" ? "desligada" : !mailbox.sendEnabled ? "envio desativado" : "DNS por rever"}` : ""}</option>)}</select></label>
        {!selectedMailboxes.length ? <p className="outreach-inline-error">Não há mailboxes selecionadas nesta campanha. Seleciona uma na secção acima.</p> : null}
        {selectedMailboxes.length ? <div className="outreach-test-mailbox-list"><strong>Estado das mailboxes desta campanha</strong>{selectedMailboxes.map((mailbox) => <div className="outreach-test-mailbox-status" key={mailbox.id}><span><strong>{mailbox.email}</strong><small>{mailboxStatus(mailbox)}</small></span>{mailbox.provider === "google" && mailbox.status === "active" && mailbox.sendEnabled && !mailbox.dnsReady ? <Button type="button" variant="secondary" disabled={dnsCheck.isPending} onClick={() => dnsCheck.mutate({ id: mailbox.id, action: "dns" })}>{dnsCheck.isPending && dnsCheck.variables?.id === mailbox.id ? "A verificar…" : "Rever DNS"}</Button> : null}</div>)}</div> : null}
        {dnsCheck.isError ? <p className="outreach-inline-error" role="alert">{dnsCheck.error instanceof Error ? dnsCheck.error.message : "Não foi possível verificar o DNS."}</p> : null}
        {settings.isLoading ? <p className="outreach-field-help">A consultar o estado do envio…</p> : settings.isError ? <p className="outreach-inline-error" role="alert">Não foi possível consultar o estado do envio. {settings.error instanceof Error ? settings.error.message : "Tenta novamente."}</p> : !outboundReady ? <p className="outreach-inline-error" role="alert">O envio global de Outreach está desligado. O teste só pode ser enviado quando a operação voltar a estar ativa.</p> : null}
        <label className="outreach-check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Confirmo que quero enviar esta mensagem real para {selectedLead?.email || "a lead selecionada"}.</label>
        {test.isError ? <p className="outreach-inline-error" role="alert">{test.error instanceof Error ? test.error.message : "Não foi possível colocar o teste em fila."}</p> : null}
        <footer><Button type="button" variant="secondary" onClick={() => setTestTarget(null)}>Cancelar</Button><Button type="submit" disabled={!contactEligible || !confirmed || !mailboxId || !outboundReady || test.isPending}>{test.isPending ? "A validar…" : "Enviar teste"}</Button></footer>
      </form>}
    </ModuleDialog>
  </section>;
}
