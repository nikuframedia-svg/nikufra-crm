import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, AlertTriangle, LockKeyhole, Save, ShieldCheck, Users } from "lucide-react";
import { Button } from "../../../components/ui";
import { formatDateTime, OutreachError, OutreachLoading, OutreachPageHeader } from "../components";
import { useAudit, useSaveSettings, useSettings, useUpdateOutreachRole } from "../hooks";
import type { OutreachRole, OutreachSettings } from "../types";

const roleLabels: Record<OutreachRole, string> = { viewer: "Viewer", sales_rep: "Sales rep", campaign_manager: "Campaign manager", admin: "Administrador CRM" };

export function OutreachSettingsPage() {
  const settings = useSettings(); const audit = useAudit(); const save = useSaveSettings();
  const updateRole = useUpdateOutreachRole();
  const [draft, setDraft] = useState<OutreachSettings | null>(null);
  useEffect(() => { if (settings.data) setDraft(settings.data); }, [settings.data]);
  if (settings.isLoading) return <OutreachLoading label="A carregar definições…" />;
  if (settings.isError || !settings.data || !draft) return <OutreachError error={settings.error} retry={() => void settings.refetch()} />;
  const isAdmin = settings.data.role === "admin";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    save.mutate({ timezone: draft.timezone, defaultDailyLimit: draft.defaultDailyLimit, bounceWarningThreshold: draft.bounceWarningThreshold, bouncePauseThreshold: draft.bouncePauseThreshold, complaintPauseThreshold: draft.complaintPauseThreshold });
  }

  return <div className="outreach-page">
    <OutreachPageHeader eyebrow="Controlo operacional" title="Definições" description="Permissões, limites e gates globais. Segredos e credenciais nunca são apresentados no browser." />
    <section className={`outreach-mode-banner outreach-mode-banner--${draft.sendMode}`}><LockKeyhole size={19} /><div><strong>Modo {draft.sendMode}</strong><p>{draft.outboundEnabled ? "O gate de ambiente está aberto; cada mailbox, campanha e destinatário continua sujeito a validação." : "OUTREACH_SEND_ENABLED está fechado. A interface não consegue contornar este bloqueio."}</p></div><span>{draft.outboundEnabled ? "Gate aberto" : "Kill switch ativo"}</span></section>
    <div className="outreach-settings-grid">
      <form className="outreach-panel outreach-settings-form" onSubmit={submit}><header><div><h3>Operação e guardrails</h3><p>Valores aplicados a novas campanhas e avaliados pelo worker.</p></div><ShieldCheck size={18} /></header><div className="outreach-form-grid"><label>Timezone<select value={draft.timezone} disabled={!isAdmin} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}><option>Europe/Lisbon</option><option>Europe/Madrid</option><option>Europe/London</option></select></label><label>Limite diário predefinido<input type="number" min={1} max={100} value={draft.defaultDailyLimit} disabled={!isAdmin} onChange={(event) => setDraft({ ...draft, defaultDailyLimit: Number(event.target.value) })} /></label><label>Aviso de bounce (%)<input type="number" min={0.1} max={20} step={0.1} value={draft.bounceWarningThreshold} disabled={!isAdmin} onChange={(event) => setDraft({ ...draft, bounceWarningThreshold: Number(event.target.value) })} /></label><label>Pausa por bounce (%)<input type="number" min={0.1} max={20} step={0.1} value={draft.bouncePauseThreshold} disabled={!isAdmin} onChange={(event) => setDraft({ ...draft, bouncePauseThreshold: Number(event.target.value) })} /></label><label>Pausa por complaint (%)<input type="number" min={0.01} max={2} step={0.01} value={draft.complaintPauseThreshold} disabled={!isAdmin} onChange={(event) => setDraft({ ...draft, complaintPauseThreshold: Number(event.target.value) })} /></label></div><div className="outreach-locked-flags"><span><b>Open tracking</b><em>{draft.trackingOpens ? "Ativo" : "Desligado"}</em></span><span><b>Click tracking</b><em>{draft.trackingClicks ? "Ativo" : "Desligado"}</em></span><small>O rollout inicial mantém ambos desligados.</small></div>{save.isError ? <div className="outreach-inline-error" role="alert">{save.error instanceof Error ? save.error.message : "Não foi possível guardar."}</div> : null}<footer><span>{isAdmin ? "Alterações registadas em auditoria." : "Apenas administradores podem editar."}</span><Button type="submit" disabled={!isAdmin || save.isPending}><Save size={14} />{save.isPending ? "A guardar…" : "Guardar"}</Button></footer></form>
      <aside className="outreach-panel outreach-access-panel"><header><div><h3>O teu acesso</h3><p>Capacidades derivadas do perfil ativo.</p></div><Users size={18} /></header><strong className="outreach-role">{roleLabels[draft.role]}</strong><ul>{draft.capabilities?.map((capability) => <li key={capability}><ShieldCheck size={13} />{capability.replaceAll("_", " ")}</li>)}</ul>{isAdmin ? <Link className="button button--secondary" to="/equipa">Gerir equipa no CRM</Link> : <p>Um administrador do CRM pode alterar o teu papel Outreach.</p>}</aside>
    </div>
    {draft.canaryAllowlist?.length ? <section className="outreach-panel outreach-allowlist"><header><div><h3>Allowlist de canary</h3><p>Destinatários permitidos para campanhas normais em canary. Testes individuais confirmados podem contactar membros da campanha fora desta lista.</p></div><span>{draft.canaryAllowlist.length}</span></header><div>{draft.canaryAllowlist.map((email) => <code key={email}>{email}</code>)}</div></section> : null}
    {isAdmin && draft.members?.length ? <section className="outreach-panel outreach-role-management"><header><div><h3>Permissões Outreach</h3><p>Administradores CRM mantêm controlo total. Os restantes papéis limitam ações na API.</p></div><Users size={18} /></header><div>{draft.members.map((member) => <div key={member.id}><span><strong>{member.name}</strong><small>{member.email}</small></span>{member.role === "admin" ? <b>Administrador CRM</b> : <select aria-label={`Papel Outreach de ${member.name}`} value={member.role} disabled={updateRole.isPending} onChange={(event) => updateRole.mutate({ profileId: member.id, outreachRole: event.target.value as "viewer" | "sales_rep" | "campaign_manager" })}><option value="viewer">Viewer</option><option value="sales_rep">Sales rep</option><option value="campaign_manager">Campaign manager</option></select>}</div>)}</div>{updateRole.isError ? <div className="outreach-inline-error" role="alert">{updateRole.error instanceof Error ? updateRole.error.message : "Não foi possível alterar o papel."}</div> : null}</section> : null}
    <section className="outreach-panel outreach-audit"><header><div><h3>Auditoria recente</h3><p>Lançamentos, alterações sensíveis e ações de utilizadores.</p></div><Activity size={18} /></header>{audit.isLoading ? <OutreachLoading label="A carregar auditoria…" /> : audit.isError ? <div className="outreach-inline-error" role="alert"><AlertTriangle size={14} />A auditoria não pôde ser carregada.</div> : <ol>{audit.data?.items.slice(0, 20).map((event) => <li key={event.id}><span /><div><strong>{event.summary || event.action}</strong><small>{event.actorName} · {event.entityType}</small></div><time>{formatDateTime(event.createdAt)}</time></li>)}</ol>}</section>
  </div>;
}
