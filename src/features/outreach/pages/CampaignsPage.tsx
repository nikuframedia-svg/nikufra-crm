import { useCallback, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Megaphone, Plus, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui";
import { CampaignBadge, EmptyPanel, formatDateTime, formatNumber, ModuleDialog, OutreachError, OutreachLoading, OutreachPageHeader, OutreachPagination, ProgressBar, SearchField, useOutreachAccess } from "../components";
import { useAudiences, useCampaigns, useCreateCampaign } from "../hooks";

export function OutreachCampaignsPage() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const campaigns = useCampaigns(page, 25, query);
  const create = useCreateCampaign();
  const navigate = useNavigate();
  const access = useOutreachAccess();
  const audiences = useAudiences(access.can("outreach.campaign.manage"));
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([{ subject: "", body: "", delayHours: 0 }]);
  const close = useCallback(() => { setOpen(false); setMessages([{ subject: "", body: "", delayHours: 0 }]); }, []);
  if (campaigns.isLoading) return <OutreachLoading label="A carregar campanhas…" />;
  if (campaigns.isError) return <OutreachError error={campaigns.error} retry={() => void campaigns.refetch()} />;
  const filtered = campaigns.data?.items ?? [];

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = await create.mutateAsync({
        name: String(form.get("name") ?? "").trim(),
        description: String(form.get("description") ?? "").trim(),
        dailyLimit: Number(form.get("dailyLimit") ?? 10),
        audienceId: String(form.get("audienceId") ?? "") || undefined,
        steps: messages.map((message, index) => ({
          delayMinutes: Math.round(message.delayHours * 60),
          replyToPrevious: index > 0,
          variants: [{ name: "A", weight: 100, subject: message.subject.trim(), body: message.body.trim() }],
        })),
      });
      close();
      await navigate({ to: "/outreach/campanhas/$campaignId", params: { campaignId: created.id } });
    } catch { /* The mutation renders the server response without closing the dialog. */ }
  }

  return <div className="outreach-page">
    <OutreachPageHeader eyebrow="Sequências" title="Campanhas" description="Cada lançamento exige audiência elegível, mailbox pronta e autorização operacional." actions={access.can("outreach.campaign.manage") ? <Button onClick={() => setOpen(true)}><Plus size={15} />Nova campanha</Button> : undefined} />
    <div className="outreach-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Pesquisar pelo nome da campanha…" /><span>{formatNumber(campaigns.data?.page?.total ?? filtered.length)} campanhas</span></div>
    {filtered.length ? <section className="outreach-campaign-grid">{filtered.map((campaign) => <Link key={campaign.id} to="/outreach/campanhas/$campaignId" params={{ campaignId: campaign.id }} className="outreach-campaign-card"><header><span className="outreach-card-icon"><Megaphone size={18} /></span><CampaignBadge status={campaign.status} /></header><h3>{campaign.name}</h3><p>{campaign.description || "Campanha sem descrição."}</p><div className="outreach-card-progress"><span><b>{Math.round(campaign.progress || 0)}%</b><small>{formatNumber(campaign.sentCount)} enviados de {formatNumber(campaign.recipientCount)}</small></span><ProgressBar value={campaign.progress} label={`Progresso de ${campaign.name}`} /></div><dl><div><dt>Respostas</dt><dd>{formatNumber(campaign.replyCount)}</dd></div><div><dt>Positivas</dt><dd>{formatNumber(campaign.positiveCount)}</dd></div><div><dt>Bounces</dt><dd>{formatNumber(campaign.bounceCount)}</dd></div></dl><footer><span>Atualizada {formatDateTime(campaign.updatedAt)}</span><ArrowRight size={15} /></footer></Link>)}</section> : <EmptyPanel icon={<Megaphone size={22} />} title={query ? "Nenhuma campanha corresponde à pesquisa" : access.can("outreach.campaign.manage") ? "Cria a primeira campanha" : "Ainda não existem campanhas"} description={query ? "Experimenta outro nome." : access.can("outreach.campaign.manage") ? "A campanha começa em rascunho e nunca envia antes de passar todos os gates." : "Um campaign manager pode criar a primeira campanha."} action={!query && access.can("outreach.campaign.manage") ? <Button onClick={() => setOpen(true)}><Plus size={15} />Nova campanha</Button> : undefined} />}
    <OutreachPagination page={campaigns.data?.page} onPageChange={setPage} />

    <ModuleDialog open={open && access.can("outreach.campaign.manage")} onClose={close} title="Nova campanha" description="Seleciona a lista de destinatários e escreve a sequência. A campanha começa em rascunho.">
      <form className="outreach-form" onSubmit={(event) => void handleCreate(event)}>
        <label>Nome<input required name="name" autoComplete="off" placeholder="Ex.: Indústria Norte · Q4" /></label>
        <label>Descrição<textarea name="description" rows={3} placeholder="Objetivo, segmento e contexto da campanha." /></label>
        <label>Lista de destinatários<select name="audienceId"><option value="">Associar mais tarde</option>{audiences.data?.items.filter((item) => item.contactCount > 0).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.contactCount} contactos</option>)}</select></label>
        {audiences.isError ? <p className="outreach-inline-error" role="alert">Não foi possível carregar as listas. Podes associar os destinatários após criar o rascunho.</p> : null}
        <p className="outreach-field-help">Só serão enviados emails a contactos elegíveis. <Link to="/outreach/audiencias" onClick={close}>Criar lista na página Audiências</Link>.</p>
        {messages.map((message, index) => <fieldset className="outreach-form-group outreach-create-step" key={index}>
          <legend>Mensagem {index + 1}</legend>
          {index > 0 ? <div className="outreach-create-step-tools"><label>Espera antes do envio (horas)<input type="number" min={0} max={8760} step={0.5} value={message.delayHours} onChange={(event) => setMessages((current) => current.map((item, at) => at === index ? { ...item, delayHours: Number(event.target.value) } : item))} /></label><button type="button" onClick={() => setMessages((current) => current.filter((_, at) => at !== index))} aria-label={`Remover mensagem ${index + 1}`}><Trash2 size={15} /></button></div> : null}
          <label>Assunto<input required autoComplete="off" value={message.subject} onChange={(event) => setMessages((current) => current.map((item, at) => at === index ? { ...item, subject: event.target.value } : item))} placeholder="{{empresa}} × Nikufra — uma hipótese concreta" /></label>
          <label>Mensagem<textarea required rows={7} value={message.body} onChange={(event) => setMessages((current) => current.map((item, at) => at === index ? { ...item, body: event.target.value } : item))} placeholder={"Olá {{nome}},\n\nEscreve aqui a mensagem…"} /></label>
          {index === 0 ? <p className="outreach-field-help">Podes usar variáveis como {"{{nome}}"}, {"{{empresa}}"} e {"{{remetente}}"}.</p> : null}
        </fieldset>)}
        <Button type="button" variant="secondary" disabled={messages.length >= 50} onClick={() => setMessages((current) => [...current, { subject: "", body: "", delayHours: 48 }])}><Plus size={14} />Adicionar mensagem</Button>
        <label>Limite diário por campanha<input name="dailyLimit" type="number" min={1} max={100} defaultValue={10} /></label>
        {create.isError ? <div className="outreach-inline-error" role="alert">{create.error instanceof Error ? create.error.message : "Não foi possível criar a campanha."}</div> : null}
        <footer><Button type="button" variant="secondary" onClick={close}>Cancelar</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "A criar…" : "Criar rascunho"}</Button></footer>
      </form>
    </ModuleDialog>
  </div>;
}
