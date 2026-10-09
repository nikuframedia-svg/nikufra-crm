import { Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Inbox, Mail, Megaphone, ShieldCheck } from "lucide-react";
import { CampaignBadge, EmptyPanel, formatDateTime, formatNumber, MetricTile, OutreachError, OutreachLoading, OutreachPageHeader, ProgressBar } from "../components";
import { useOverview } from "../hooks";

export function OutreachOverviewPage() {
  const query = useOverview();
  if (query.isLoading) return <OutreachLoading />;
  if (query.isError || !query.data) return <OutreachError error={query.error} retry={() => void query.refetch()} />;
  const data = query.data;
  const positiveRate = data.repliesTotal ? (data.positiveReplies / data.repliesTotal) * 100 : 0;

  return <div className="outreach-page">
    <OutreachPageHeader eyebrow="Operação" title="Resumo de Outreach" description="Estado de envio, campanhas e respostas, com os guardrails reais aplicados pelo worker." actions={<Link className="button button--primary" to="/outreach/campanhas"><Megaphone size={15} />Ver campanhas</Link>} />

    <section className={`outreach-mode-banner outreach-mode-banner--${data.sendMode}`}>
      <ShieldCheck size={19} />
      <div><strong>{data.sendMode === "live" ? "Outbound em produção" : data.sendMode === "canary" ? "Canary controlado" : "Envios reais bloqueados"}</strong><p>{data.sendMode === "live" ? "A elegibilidade é revalidada imediatamente antes de cada submissão." : data.sendMode === "canary" ? "Campanhas normais usam a allowlist. Um teste individual confirmado pode contactar um destinatário da campanha, sujeito à quota e aos restantes controlos." : "Inbound e reconciliação continuam ativos; nenhum job pode enviar."}</p></div>
      <span>{data.outboundEnabled ? "Gate aberto" : "Kill switch ativo"}</span>
    </section>

    <div className="outreach-metrics">
      <MetricTile label="Campanhas" value={formatNumber(data.campaignsTotal)} detail={`${formatNumber(data.campaignsRunning)} ativas`} icon={<Megaphone size={17} />} />
      <MetricTile label="Enviados hoje" value={formatNumber(data.sentToday)} detail={data.dailyCapacity ? `${formatNumber(data.dailyCapacity)} de capacidade` : "volume outbound de hoje"} icon={<Mail size={17} />} />
      <MetricTile label="Respostas" value={formatNumber(data.repliesTotal)} detail="respostas indexadas" icon={<Inbox size={17} />} />
      <MetricTile label="Positivas" value={formatNumber(data.positiveReplies)} detail={`${positiveRate.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}% das respostas · ${formatNumber(data.queuedJobs)} jobs em fila`} icon={<Activity size={17} />} />
    </div>

    <div className="outreach-dashboard-grid">
      <section className="outreach-panel">
        <header><div><h3>Campanhas recentes</h3><p>Progresso calculado a partir de destinatários materializados.</p></div><Link to="/outreach/campanhas">Todas <ArrowRight size={14} /></Link></header>
        {data.campaigns?.length ? <div className="outreach-list">{data.campaigns.slice(0, 6).map((campaign) => <Link key={campaign.id} to="/outreach/campanhas/$campaignId" params={{ campaignId: campaign.id }} className="outreach-campaign-row"><span><strong>{campaign.name}</strong><small>{formatNumber(campaign.recipientCount)} destinatários · atualizado {formatDateTime(campaign.updatedAt)}</small></span><CampaignBadge status={campaign.status} /><span className="outreach-row-progress"><b>{Math.round(campaign.progress || 0)}%</b><ProgressBar value={campaign.progress} label={`Progresso de ${campaign.name}`} /></span><ArrowRight size={15} /></Link>)}</div> : <EmptyPanel title="Ainda não existem campanhas" description="Cria uma campanha e associa uma audiência composta por contactos do CRM." action={<Link className="button button--secondary" to="/outreach/campanhas">Criar campanha</Link>} />}
      </section>
      <aside className="outreach-panel outreach-queue-panel">
        <header><div><h3>Próximos jobs</h3><p>Fila apenas informativa; o worker revalida tudo.</p></div><span>{formatNumber(data.queuedJobs)}</span></header>
        {data.nextJobs?.length ? <ol>{data.nextJobs.slice(0, 7).map((job) => <li key={job.id}><span /><div><strong>{job.contactName}</strong><small>{job.campaignName}</small></div><time>{formatDateTime(job.dueAt)}</time></li>)}</ol> : <EmptyPanel icon={<ShieldCheck size={20} />} title="Sem envios iminentes" description={data.outboundEnabled ? "A fila não tem jobs nos próximos ciclos." : "O kill switch impede a execução de jobs."} />}
      </aside>
    </div>
  </div>;
}
