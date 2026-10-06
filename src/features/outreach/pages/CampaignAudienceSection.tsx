import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, UsersRound } from "lucide-react";
import { Button } from "../../../components/ui";
import { formatNumber, OutreachPagination } from "../components";
import { useAttachAudienceToCampaign, useAudiences, useCampaignRecipients } from "../hooks";
import type { CampaignDetail } from "../types";

const recipientStatus: Record<string, string> = {
  eligible: "Elegível", ineligible: "Bloqueado", pending: "Pendente", active: "Em curso",
  replied: "Respondeu", completed: "Concluído", suppressed: "Suprimido", bounced: "Bounce",
  reconciliation_required: "A reconciliar", deleted: "Eliminado",
};

export function CampaignAudienceSection({ campaign, canManage }: { campaign: CampaignDetail; canManage: boolean }) {
  const [page, setPage] = useState(1);
  const [audienceId, setAudienceId] = useState("");
  const audiences = useAudiences(canManage);
  const recipients = useCampaignRecipients(campaign.id, page, canManage);
  const attach = useAttachAudienceToCampaign();
  const linked = (audiences.data?.items ?? []).filter((item) => campaign.audienceIds.includes(item.id));
  const available = (audiences.data?.items ?? []).filter((item) => !campaign.audienceIds.includes(item.id) && item.contactCount > 0);
  const editable = canManage && campaign.status === "draft";

  async function addAudience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!audienceId) return;
    try {
      await attach.mutateAsync({ campaignId: campaign.id, audienceId });
      setAudienceId("");
      setPage(1);
      void recipients.refetch();
    } catch { /* Keep the selection and show the API error. */ }
  }

  return <section className="outreach-panel outreach-campaign-audience">
    <header><div><h3>Destinatários</h3><p>Associa uma lista de contactos do CRM. Cada endereço é reavaliado antes do envio.</p></div><span>{formatNumber(campaign.readiness.eligibleRecipientCount)} elegíveis de {formatNumber(campaign.recipientCount)}</span></header>
    {linked.length ? <div className="outreach-attached-audiences">{linked.map((item) => <span key={item.id}><UsersRound size={14} />{item.name}<small>{formatNumber(item.contactCount)} contactos</small></span>)}</div> : <p className="outreach-panel-empty">Nenhuma lista associada a esta campanha.</p>}
    {editable ? <form className="outreach-audience-attach" onSubmit={(event) => void addAudience(event)}>
      <label>Lista de destinatários
        <select value={audienceId} onChange={(event) => setAudienceId(event.target.value)} required>
          <option value="">Seleciona uma audiência…</option>
          {available.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.contactCount} contactos</option>)}
        </select>
      </label>
      <Button type="submit" disabled={!audienceId || attach.isPending}><Plus size={14} />{attach.isPending ? "A associar…" : "Adicionar lista"}</Button>
      <Link to="/outreach/audiencias">Criar ou editar lista</Link>
    </form> : null}
    {canManage && campaign.status !== "draft" ? <p className="outreach-field-help outreach-section-note">Para alterar a lista desta campanha, cria um novo rascunho. Os destinatários já em envio mantêm o seu histórico.</p> : null}
    {audiences.isError || recipients.isError || attach.isError ? <p className="outreach-inline-error" role="alert">{attach.error instanceof Error ? attach.error.message : recipients.error instanceof Error ? recipients.error.message : audiences.error instanceof Error ? audiences.error.message : "Não foi possível carregar os destinatários."}</p> : null}
    {canManage && (recipients.data?.items ?? []).length ? <div className="outreach-recipient-table"><div className="outreach-table-scroll"><table className="outreach-table"><thead><tr><th>Contacto</th><th>Empresa</th><th>Lista</th><th>Estado</th></tr></thead><tbody>{recipients.data?.items.map((item) => <tr key={item.id}><td><strong>{item.contactName || "Contacto removido"}</strong><small>{item.email || "Sem email"}</small></td><td>{item.companyName || "—"}</td><td>{item.audienceName || "—"}</td><td><span title={item.reasons.join(" · ")}>{recipientStatus[item.status] ?? item.status}</span>{item.reasons.length ? <small>{item.reasons.join(" · ")}</small> : null}</td></tr>)}</tbody></table></div><OutreachPagination page={recipients.data?.page} onPageChange={setPage} /></div> : null}
  </section>;
}
