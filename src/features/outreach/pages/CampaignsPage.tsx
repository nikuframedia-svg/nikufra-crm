import { useCallback, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Megaphone, Plus } from "lucide-react";
import { Button } from "../../../components/ui";
import { CampaignBadge, EmptyPanel, formatDateTime, formatNumber, ModuleDialog, OutreachError, OutreachLoading, OutreachPageHeader, OutreachPagination, ProgressBar, SearchField, useOutreachAccess } from "../components";
import { useCampaigns, useCreateCampaign } from "../hooks";

export function OutreachCampaignsPage() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const campaigns = useCampaigns(page, 25, query);
  const create = useCreateCampaign();
  const navigate = useNavigate();
  const access = useOutreachAccess();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
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
        steps: [{
          delayMinutes: 0,
          replyToPrevious: true,
          variants: [{ name: "A", weight: 100, subject: String(form.get("subject") ?? "").trim(), body: String(form.get("body") ?? "").trim() }],
        }],
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

    <ModuleDialog open={open && access.can("outreach.campaign.manage")} onClose={close} title="Nova campanha" description="Define a primeira mensagem. Destinatários e mailboxes são associados depois.">
      <form className="outreach-form" onSubmit={(event) => void handleCreate(event)}>
        <label>Nome<input required name="name" autoComplete="off" placeholder="Ex.: Indústria Norte · Q4" /></label>
        <label>Descrição<textarea name="description" rows={3} placeholder="Objetivo, segmento e contexto da campanha." /></label>
        <fieldset className="outreach-form-group">
          <legend>Primeira mensagem</legend>
          <label>Assunto<input required name="subject" autoComplete="off" placeholder="{{empresa}} × Nikufra — uma hipótese concreta" /></label>
          <label>Mensagem<textarea required name="body" rows={7} placeholder={"Olá {{nome}},\n\nEscreve aqui a mensagem inicial…"} /></label>
          <p className="outreach-field-help">Podes usar variáveis como {"{{nome}}"}, {"{{empresa}}"} e {"{{remetente}}"}.</p>
        </fieldset>
        <label>Limite diário por campanha<input name="dailyLimit" type="number" min={1} max={100} defaultValue={10} /></label>
        {create.isError ? <div className="outreach-inline-error" role="alert">{create.error instanceof Error ? create.error.message : "Não foi possível criar a campanha."}</div> : null}
        <footer><Button type="button" variant="secondary" onClick={close}>Cancelar</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "A criar…" : "Criar rascunho"}</Button></footer>
      </form>
    </ModuleDialog>
  </div>;
}
