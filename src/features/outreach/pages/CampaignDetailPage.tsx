import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Mail, Pause, Play, UsersRound } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "../../../components/ui";
import { CampaignBadge, formatDateTime, formatNumber, MetricTile, OutreachError, OutreachLoading, OutreachPageHeader, ProgressBar, useOutreachAccess } from "../components";
import { useCampaign, useCampaignAction, useSetCampaignMailboxes } from "../hooks";
import { CampaignAudienceSection } from "./CampaignAudienceSection";
import { CampaignSequenceSection } from "./CampaignSequenceSection";

export function OutreachCampaignDetailPage() {
  const params = useParams({ strict: false }) as { campaignId?: string };
  const id = params.campaignId ?? "";
  const campaign = useCampaign(id);
  const action = useCampaignAction(id);
  const saveMailboxes = useSetCampaignMailboxes(id);
  const [selectedMailboxes, setSelectedMailboxes] = useState<string[]>([]);
  useEffect(() => {
    if (campaign.data) setSelectedMailboxes(campaign.data.mailboxIds);
  }, [campaign.data]);
  const access = useOutreachAccess();
  if (campaign.isLoading) return <OutreachLoading label="A carregar campanha…" />;
  if (campaign.isError || !campaign.data) return <OutreachError error={campaign.error} retry={() => void campaign.refetch()} />;
  const data = campaign.data;
  const nextAction = data.status === "running" ? "pause" : data.status === "paused" ? "resume" : "launch";
  const canAct = access.can("outreach.campaign.launch") && ["draft", "running", "paused"].includes(data.status);
  const canEditMailboxes = access.can("outreach.campaign.manage") && data.status === "draft";
  const mailboxesChanged = selectedMailboxes.length !== data.mailboxIds.length || selectedMailboxes.some((mailboxId) => !data.mailboxIds.includes(mailboxId));
  return <div className="outreach-page">
    <Link to="/outreach/campanhas" className="outreach-back"><ArrowLeft size={14} />Campanhas</Link>
    <OutreachPageHeader eyebrow="Campanha" title={data.name} description={data.description || "Campanha sem descrição."} actions={<><CampaignBadge status={data.status} />{canAct ? <Button disabled={action.isPending} variant={data.status === "running" ? "secondary" : "primary"} onClick={() => action.mutate(nextAction)}>{data.status === "running" ? <Pause size={15} /> : <Play size={15} />}{action.isPending ? "A validar…" : data.status === "running" ? "Pausar" : data.status === "paused" ? "Retomar" : "Lançar"}</Button> : null}</>} />
    {action.isError ? <div className="outreach-inline-error" role="alert"><AlertTriangle size={15} />{action.error instanceof Error ? action.error.message : "A ação foi recusada pelos guardrails."}</div> : null}
    {(data.blockers?.length || data.warnings?.length) ? <section className="outreach-readiness"><header><AlertTriangle size={18} /><div><strong>Readiness antes do envio</strong><p>O backend volta a verificar estes pontos em cada job.</p></div></header>{data.blockers?.map((blocker) => <p className="is-blocker" key={blocker}><span />{blocker}</p>)}{data.warnings?.map((warning) => <p className="is-warning" key={warning}><span />{warning}</p>)}</section> : <section className="outreach-readiness is-ready"><CheckCircle2 size={18} /><div><strong>Sem bloqueios conhecidos</strong><p>A elegibilidade ainda é revalidada imediatamente antes do envio.</p></div></section>}
    <section className="outreach-panel outreach-campaign-mailboxes"><header><div><h3>Mailboxes desta campanha</h3><p>O envio usa apenas as mailboxes selecionadas e prontas.</p></div><span>{data.readiness.readyMailboxCount} prontas de {data.readiness.selectedMailboxCount} selecionadas</span></header>
      {data.availableMailboxes.length ? <form onSubmit={(event) => { event.preventDefault(); saveMailboxes.mutate(selectedMailboxes); }}>
        <div className="outreach-campaign-mailbox-list">{data.availableMailboxes.map((mailbox) => <label key={mailbox.id}>
          <input type="checkbox" checked={selectedMailboxes.includes(mailbox.id)} disabled={!canEditMailboxes || mailbox.provider !== "google" || saveMailboxes.isPending} onChange={(event) => setSelectedMailboxes((current) => event.target.checked ? [...current, mailbox.id] : current.filter((item) => item !== mailbox.id))} />
          <span><strong>{mailbox.displayName || mailbox.email}</strong><small>{mailbox.email} · {mailbox.provider === "google" ? mailbox.ready ? "Pronta para envio" : mailbox.dnsReady ? "Ligada, envio desativado" : "Requer ligação ou DNS" : "Provider ainda indisponível"}</small></span>
        </label>)}</div>
        {!canEditMailboxes && data.status !== "draft" ? <p className="outreach-field-help">A seleção de remetentes fica bloqueada depois do primeiro lançamento para não alterar jobs já materializados.</p> : null}
        {saveMailboxes.isError ? <p className="outreach-inline-error" role="alert">{saveMailboxes.error instanceof Error ? saveMailboxes.error.message : "Não foi possível guardar a seleção de mailboxes."}</p> : null}
        {canEditMailboxes ? <footer><Button type="submit" disabled={!mailboxesChanged || saveMailboxes.isPending}>{saveMailboxes.isPending ? "A guardar…" : "Guardar seleção"}</Button></footer> : null}
      </form> : <p className="outreach-panel-empty">Ainda não existem mailboxes Outreach disponíveis para esta campanha.</p>}
    </section>
    <div className="outreach-metrics">
      <MetricTile label="Destinatários" value={formatNumber(data.recipientCount)} detail={`${Math.round(data.progress || 0)}% processados`} icon={<UsersRound size={17} />} />
      <MetricTile label="Enviados" value={formatNumber(data.sentCount)} detail={`Limite ${formatNumber(data.dailyLimit)}/dia`} icon={<Mail size={17} />} />
      <MetricTile label="Respostas" value={formatNumber(data.replyCount)} detail={`${formatNumber(data.positiveCount)} positivas`} icon={<CheckCircle2 size={17} />} />
      <MetricTile label="Lançada" value={data.launchedAt ? "Sim" : "Não"} detail={formatDateTime(data.launchedAt)} icon={<Clock3 size={17} />} />
    </div>
    <CampaignAudienceSection campaign={data} canManage={access.can("outreach.campaign.manage")} />
    <div className="outreach-detail-grid">
      <CampaignSequenceSection campaign={data} canManage={access.can("outreach.campaign.manage")} canTest={access.can("outreach.campaign.manage") && access.can("outreach.campaign.launch")} />
      <aside className="outreach-panel"><header><div><h3>Configuração segura</h3><p>Comportamento aplicado pelo worker.</p></div></header><dl className="outreach-settings-list"><div><dt>Parar ao responder</dt><dd>{data.settings?.stopOnReply ? "Ativo" : "Inativo"}</dd></div><div><dt>Parar empresa ao responder</dt><dd>{data.settings?.stopCompanyOnReply ? "Ativo" : "Inativo"}</dd></div><div><dt>One-click unsubscribe</dt><dd>{data.settings?.includeUnsubscribe ? "Ativo" : "Inativo"}</dd></div><div><dt>Open tracking</dt><dd>{data.settings?.trackOpens ? "Ativo" : "Desligado"}</dd></div><div><dt>Click tracking</dt><dd>{data.settings?.trackClicks ? "Ativo" : "Desligado"}</dd></div></dl><div className="outreach-total-progress"><span><strong>Progresso</strong><b>{Math.round(data.progress || 0)}%</b></span><ProgressBar value={data.progress} label="Progresso total da campanha" /></div></aside>
    </div>
  </div>;
}
