import { useState, type FormEvent } from "react";
import { AlertTriangle, Check, Plus, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui";
import {
  EmptyPanel,
  formatDateTime,
  formatNumber,
  formatPercent,
  MailboxBadge,
  MetricTile,
  ModuleDialog,
  OutreachError,
  OutreachLoading,
  OutreachPageHeader,
  ProgressBar,
  useOutreachAccess,
} from "../components";
import { useCreateSuppression, useDeleteSuppression, useMailboxes, useMetrics, useSuppressions } from "../hooks";
import type { Suppression } from "../types";

export function OutreachDeliverabilityPage() {
  const access = useOutreachAccess();
  const canManageMailboxes = access.can("outreach.mailbox.manage");
  const canManageSuppressions = access.can("outreach.suppression.manage");
  const metrics = useMetrics(30);
  const mailboxes = useMailboxes(canManageMailboxes);
  const suppressions = useSuppressions(canManageSuppressions);
  const create = useCreateSuppression();
  const remove = useDeleteSuppression();
  const [createOpen, setCreateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Suppression | null>(null);
  const [scope, setScope] = useState<"email" | "domain">("email");

  if (metrics.isLoading || (canManageMailboxes && mailboxes.isLoading) || (canManageSuppressions && suppressions.isLoading)) return <OutreachLoading label="A calcular deliverability…" />;
  if (metrics.isError) return <OutreachError error={metrics.error} retry={() => { void metrics.refetch(); }} />;

  const items = mailboxes.data?.items ?? [];
  const blocked = suppressions.data?.items ?? [];
  const totals = metrics.data?.totals ?? { sent: 0, replies: 0, positiveReplies: 0, hardBounces: 0, complaints: 0, unsubscribes: 0 };
  const bounceRate = totals.sent ? (totals.hardBounces / totals.sent) * 100 : 0;

  async function submitSuppression(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = String(form.get("value") ?? "").trim();
    const reason = form.get("reason") === "legal" ? "legal" : "manual";
    const note = String(form.get("note") ?? "").trim();
    try {
      if (scope === "email") await create.mutateAsync({ scope, email: value, reason, note });
      else await create.mutateAsync({ scope, domain: value.replace(/^@/, ""), reason, note });
      setCreateOpen(false);
    } catch { /* Keep the dialog open and show the server validation message. */ }
  }

  async function confirmRemoval() {
    if (!removeTarget) return;
    try {
      await remove.mutateAsync(removeTarget.id);
      setRemoveTarget(null);
    } catch { /* Confirmation stays open until the request succeeds or is cancelled. */ }
  }

  return <div className="outreach-page">
    <OutreachPageHeader eyebrow="Reputação" title="Deliverability" description="Saúde das mailboxes, autenticação e suppressions globais avaliadas antes de todos os envios." />
    <div className="outreach-metrics">
      <MetricTile label="Enviados" value={formatNumber(totals.sent)} detail={`últimos ${metrics.data?.days ?? 30} dias`} icon={<Check size={17} />} />
      <MetricTile label="Respostas" value={formatNumber(totals.replies)} detail={`${formatNumber(totals.positiveReplies)} positivas`} icon={<ShieldCheck size={17} />} />
      <MetricTile label="Hard bounces" value={formatNumber(totals.hardBounces)} detail={`${formatPercent(bounceRate)} dos envios`} icon={<AlertTriangle size={17} />} />
      <MetricTile label="Complaints" value={formatNumber(totals.complaints)} detail={`${formatNumber(totals.unsubscribes)} unsubscribes`} icon={<ShieldOff size={17} />} />
    </div>

    {canManageMailboxes ? <section className="outreach-panel">
      <header><div><h3>Saúde por mailbox</h3><p>DNS histórico não desbloqueia envio; as verificações são repetidas no ambiente atual.</p></div></header>
      {mailboxes.isError ? <EmptyPanel icon={<AlertTriangle size={20} />} title="Saúde temporariamente indisponível" description="As métricas agregadas continuam visíveis; repete a consulta das mailboxes mais tarde." /> : items.length ? <div className="outreach-health-table">{items.map((mailbox) => <div key={mailbox.id}>
        <span className={`outreach-health-dot outreach-health-dot--${mailbox.status}`} />
        <span><strong>{mailbox.email}</strong><small>{mailbox.lastError || "Sem incidentes reportados"}</small></span>
        <span><b>{Math.round(mailbox.healthScore)}%</b><ProgressBar value={mailbox.healthScore} label={`Saúde de ${mailbox.email}`} /></span>
        <span>{formatPercent(mailbox.bounceRate)}<small>Bounce</small></span>
        <MailboxBadge status={mailbox.status} />
      </div>)}</div> : <EmptyPanel title="Sem dados de deliverability" description="Liga uma mailbox para validar saúde e DNS." />}
    </section> : null}

    {canManageSuppressions ? <section className="outreach-panel outreach-suppressions">
      <header><div><h3>Suppressions globais</h3><p>Autoridade única para CRM e Outreach. Remover uma entrada é uma operação sensível.</p></div>{suppressions.isError ? <span>Restrito</span> : <Button variant="secondary" onClick={() => setCreateOpen(true)}><Plus size={14} />Adicionar</Button>}</header>
      {suppressions.isError
        ? <EmptyPanel icon={<ShieldOff size={20} />} title="Acesso reservado" description="Só administradores podem consultar ou alterar a lista global de suppressions." />
        : blocked.length
          ? <div className="outreach-table-scroll"><table className="outreach-table"><thead><tr><th>Âmbito</th><th>Valor</th><th>Motivo</th><th>Nota</th><th>Data</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{blocked.map((item) => <tr key={item.id}><td>{item.scope}</td><td><strong>{item.value}</strong></td><td>{item.reason}</td><td>{item.note || "—"}</td><td>{formatDateTime(item.createdAt)}</td><td><Button variant="ghost" disabled={remove.isPending} onClick={() => setRemoveTarget(item)}><Trash2 size={14} />Remover</Button></td></tr>)}</tbody></table></div>
          : <EmptyPanel icon={<ShieldCheck size={20} />} title="Sem suppressions" description="Opt-outs, complaints e hard bounces aparecerão automaticamente aqui." action={<Button variant="secondary" onClick={() => setCreateOpen(true)}><Plus size={14} />Adicionar bloqueio manual</Button>} />}
      {(remove.isError || create.isError) ? <div className="outreach-inline-error" role="alert">{(remove.error ?? create.error) instanceof Error ? (remove.error ?? create.error)?.message : "Não foi possível atualizar a suppression."}</div> : null}
    </section> : null}

    <ModuleDialog open={createOpen && canManageSuppressions} onClose={() => setCreateOpen(false)} title="Adicionar suppression" description="Bloqueia imediatamente todos os jobs futuros para este endereço ou domínio.">
      <form className="outreach-form" onSubmit={(event) => void submitSuppression(event)}>
        <label>Âmbito<select value={scope} onChange={(event) => setScope(event.target.value as "email" | "domain")}><option value="email">Endereço de email</option><option value="domain">Domínio inteiro</option></select></label>
        <label>{scope === "email" ? "Email" : "Domínio"}<input required name="value" type={scope === "email" ? "email" : "text"} autoComplete="off" placeholder={scope === "email" ? "contacto@empresa.pt" : "empresa.pt"} /></label>
        <label>Motivo<select name="reason"><option value="manual">Bloqueio manual</option><option value="legal">Obrigação legal</option></select></label>
        <label>Nota<textarea name="note" rows={3} maxLength={2000} placeholder="Contexto para a equipa e para a auditoria." /></label>
        <div className="outreach-consent-note"><ShieldOff size={16} /><p>A suppression é global: afeta campanhas atuais e futuras e cancela jobs ainda não enviados.</p></div>
        <footer><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "A bloquear…" : "Adicionar suppression"}</Button></footer>
      </form>
    </ModuleDialog>

    <ModuleDialog open={Boolean(removeTarget) && canManageSuppressions} onClose={() => setRemoveTarget(null)} title="Remover suppression?" description="Esta ação volta a tornar o endereço elegível para futuras campanhas, desde que passe os restantes guardrails.">
      <div className="outreach-confirmation">
        <p><strong>{removeTarget?.value}</strong></p>
        <p>Confirma apenas se a origem do bloqueio foi analisada. Um opt-out, complaint ou hard bounce não deve ser removido sem base documentada.</p>
        <footer><Button variant="secondary" onClick={() => setRemoveTarget(null)}>Manter bloqueio</Button><Button variant="danger" disabled={remove.isPending} onClick={() => void confirmRemoval()}>{remove.isPending ? "A remover…" : "Remover suppression"}</Button></footer>
      </div>
    </ModuleDialog>
  </div>;
}
