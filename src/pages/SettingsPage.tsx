import { useEffect, useState } from "react";
import { Bot, Check, ChevronRight, Copy, Database, ExternalLink, KeyRound, Mail, Save, ShieldCheck, SlidersHorizontal, UserCheck, Users } from "lucide-react";
import { stageLabels, stageOrder, stageProbability } from "../data/seed";
import { useCRM } from "../state/crm-context";
import { supabase } from "../lib/supabase";
import { startGoogleOAuth } from "../lib/google-oauth";
import { Avatar, Button, Card, Modal, PageHeader } from "../components/ui";

async function functionErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "context" in error && error.context instanceof Response) {
    try {
      const body = await error.context.clone().json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
    } catch { /* The SDK message below remains a safe fallback. */ }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export function SettingsPage() {
  const { team, currentUserId } = useCRM();
  const [section, setSection] = useState("users");
  const [saved, setSaved] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailError, setGmailError] = useState("");
  const [gmailStatus, setGmailStatus] = useState<{ backfill_complete: boolean; messages_synced: number; contacts_created: number; people_contacts_synced: number; calendar_events_synced: number; people_sync_token: string | null; other_contacts_sync_token: string | null; calendar_sync_token: string | null; last_sync_at: string | null; calendar_last_sync_at: string | null; sync_error: string | null } | null>(null);
  const [probabilities, setProbabilities] = useState<Record<string, number>>(() => ({ ...stageProbability }));
  const [goals, setGoals] = useState({ annual: 0, monthly: 0, meetings: 0, proposals: 0 });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [teamError, setTeamError] = useState("");
  const [roleBusyId, setRoleBusyId] = useState("");
  const [roleOverrides, setRoleOverrides] = useState<Record<string, "admin" | "member">>({});
  const [pendingUsers, setPendingUsers] = useState<Array<{ id: string; nome: string; email: string }>>([]);
  const [mcpCopied, setMcpCopied] = useState(false);

  const now = new Date(); const currentYear = now.getFullYear(); const currentMonth = now.getMonth() + 1;
  const localBackend = /localhost|127\.0\.0\.1/.test(import.meta.env.VITE_SUPABASE_URL ?? "");
  const isAdmin = team.find((owner) => owner.id === currentUserId)?.role === "admin";

  async function loadGmailStatus() {
    if (!supabase) return;
    const { data } = await supabase.from("google_tokens").select("backfill_complete,messages_synced,contacts_created,people_contacts_synced,calendar_events_synced,people_sync_token,other_contacts_sync_token,calendar_sync_token,last_sync_at,calendar_last_sync_at,sync_error").eq("user_id", currentUserId).maybeSingle();
    setGmailConnected(Boolean(data)); setGmailStatus(data ?? null);
  }

  useEffect(() => {
    if (!supabase) return;
    void loadGmailStatus();
    void supabase.from("pipeline_settings").select("estado,probabilidade_padrao").then(({ data }) => { if (data?.length) setProbabilities(Object.fromEntries(data.map((item) => [item.estado, item.probabilidade_padrao]))); });
    void supabase.from("objetivos").select("mes,tipo,valor_alvo").eq("ano", currentYear).then(({ data }) => { if (!data) return; setGoals((current) => ({ annual: Number(data.find((item) => item.tipo === "faturacao" && item.mes === null)?.valor_alvo ?? current.annual), monthly: Number(data.find((item) => item.tipo === "faturacao" && item.mes === currentMonth)?.valor_alvo ?? current.monthly), meetings: Number(data.find((item) => item.tipo === "reunioes" && item.mes === currentMonth)?.valor_alvo ?? current.meetings), proposals: Number(data.find((item) => item.tipo === "propostas" && item.mes === currentMonth)?.valor_alvo ?? current.proposals) })); });
    void supabase.from("profiles").select("id,nome,email").eq("ativo", false).then(({ data }) => setPendingUsers(data ?? []));
  }, [currentUserId]);

  useEffect(() => {
    const handleConnected = () => {
      setGmailConnected(true); setGmailError("");
      void loadGmailStatus();
    };
    window.addEventListener("nikufra:gmail-connected", handleConnected);
    return () => window.removeEventListener("nikufra:gmail-connected", handleConnected);
  }, []);

  async function handleSaveCommercialSettings() {
    setSaved(false);
    if (supabase) {
      const { error } = await supabase.from("pipeline_settings").upsert(stageOrder.map((stage, index) => ({ estado: stage, probabilidade_padrao: probabilities[stage], ordem: index + 1 })), { onConflict: "estado" });
      if (error) return;
      const targetRows = [{ mes: null, tipo: "faturacao", valor: goals.annual }, { mes: currentMonth, tipo: "faturacao", valor: goals.monthly }, { mes: currentMonth, tipo: "reunioes", valor: goals.meetings }, { mes: currentMonth, tipo: "propostas", valor: goals.proposals }];
      for (const target of targetRows) {
        let query = supabase.from("objetivos").select("id").eq("ano", currentYear).eq("tipo", target.tipo).is("user_id", null);
        query = target.mes === null ? query.is("mes", null) : query.eq("mes", target.mes);
        const { data } = await query.maybeSingle();
        if (data) await supabase.from("objetivos").update({ valor_alvo: target.valor }).eq("id", data.id);
        else await supabase.from("objetivos").insert({ ano: currentYear, mes: target.mes, tipo: target.tipo, valor_alvo: target.valor, user_id: null });
      }
    }
    setSaved(true); window.setTimeout(() => setSaved(false), 1800);
  }

  async function handleRoleChange(ownerId: string, role: "admin" | "member") {
    if (!supabase || !isAdmin) return;
    const previousRole = roleOverrides[ownerId] ?? team.find((owner) => owner.id === ownerId)?.role ?? "member";
    setTeamError(""); setRoleBusyId(ownerId); setRoleOverrides((current) => ({ ...current, [ownerId]: role }));
    const { error } = await supabase.from("profiles").update({ role }).eq("id", ownerId);
    if (error) {
      setRoleOverrides((current) => ({ ...current, [ownerId]: previousRole }));
      setTeamError(error.message);
    }
    setRoleBusyId("");
  }

  async function handleInvite(form: HTMLFormElement) {
    setInviteNotice(null);
    if (!supabase || !isAdmin) { setInviteNotice({ kind: "error", text: "Apenas um administrador pode enviar convites." }); return; }
    const formData = new FormData(form);
    setInviteBusy(true);
    const { error } = await supabase.functions.invoke("invite-user", { body: { nome: String(formData.get("nome")).trim(), email: String(formData.get("email")).trim().toLowerCase() } });
    if (error) setInviteNotice({ kind: "error", text: await functionErrorMessage(error, "Não foi possível enviar o convite.") });
    else {
      form.reset();
      setInviteNotice({ kind: "success", text: "Convite enviado por email. O acesso fica autorizado apenas para esse endereço." });
    }
    setInviteBusy(false);
  }

  async function handleApproveUser(userId: string) {
    setTeamError("");
    if (supabase && isAdmin) {
      const { error } = await supabase.from("profiles").update({ ativo: true }).eq("id", userId);
      if (error) { setTeamError(error.message); return; }
    }
    setPendingUsers((current) => current.filter((user) => user.id !== userId));
  }

  async function handleConnectGmail() {
    if (!supabase) { setGmailError("A API do servidor não está configurada neste ambiente local. Define VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY e publica as funções Google antes de ligar a conta."); return; }
    setGmailBusy(true); setGmailError("");
    try {
      await startGoogleOAuth();
    } catch (error) { setGmailError(error instanceof Error ? error.message : "Não foi possível iniciar o OAuth"); }
    setGmailBusy(false);
  }
  async function handleSyncGmail() {
    if (!supabase) { setGmailError("A API do servidor não está configurada neste ambiente local."); return; }
    setGmailBusy(true); setGmailError("");
    const { error } = await supabase.functions.invoke("gmail-sync", { body: {} });
    if (error) setGmailError(error.message);
    await loadGmailStatus(); setGmailBusy(false);
  }

  async function handleOpenClaudeConnectors() {
    const mcpUrl = `${window.location.origin}/functions/v1/mcp`;
    try { await navigator.clipboard.writeText(mcpUrl); setMcpCopied(true); }
    catch { setMcpCopied(false); }
    window.open("https://claude.ai/settings/connectors", "_blank", "noopener,noreferrer");
    window.setTimeout(() => setMcpCopied(false), 3000);
  }
  return (
    <div className="page">
      <PageHeader eyebrow="Administração" title="Definições" description="Utilizadores, objetivos, probabilidades e integrações. Alterações sensíveis ficam em audit log." />
      <div className="settings-layout">
        <Card className="settings-nav">{[
          ["users", Users, "Utilizadores", "Contas e permissões"],
          ["goals", SlidersHorizontal, "Objetivos e funil", "Metas e probabilidades"],
          ["security", ShieldCheck, "Segurança", "Sessões e autenticação"],
          ["gmail", Mail, "Integração Google", "Email, contactos e reuniões"],
          ["claude", Bot, "Claude MCP", "Usar o CRM dentro do Claude"],
          ["data", Database, "Dados e RGPD", "Exportação e retenção"],
        ].map(([id, Icon, label, detail]) => <button key={String(id)} className={section === id ? "is-active" : ""} onClick={() => setSection(String(id))}><Icon size={17} /><span><strong>{String(label)}</strong><small>{String(detail)}</small></span><ChevronRight size={15} /></button>)}</Card>
        <Card className="settings-content">
          {section === "users" ? <><div className="settings-header"><div><p className="eyebrow">Acesso partilhado</p><h2>Utilizadores</h2><p>Cada pessoa entra pelo endereço Google previamente convidado por um administrador.</p></div>{isAdmin ? <Button onClick={() => { setInviteOpen(true); setInviteNotice(null); }}><UserCheck size={16} />Convidar por email</Button> : null}</div>{teamError ? <div className="auth-error" role="alert">{teamError}</div> : null}<div className="user-list">{team.map((owner) => <div key={owner.id}><Avatar ownerId={owner.id} size="md" /><span><strong>{owner.nome}{owner.id === currentUserId ? <em>Tu</em> : null}</strong><small>{owner.email}</small></span><span className="user-status"><i />Ativo</span><select value={roleOverrides[owner.id] ?? owner.role} disabled={!isAdmin || roleBusyId === owner.id} aria-label={`Permissão de ${owner.nome}`} onChange={(event) => void handleRoleChange(owner.id, event.target.value as "admin" | "member")}><option value="admin">Administrador</option><option value="member">Membro</option></select><button className="icon-button" aria-label={`Ver ${owner.nome}`}><ChevronRight size={15} /></button></div>)}</div>{pendingUsers.map((user) => <div className="pending-user" key={user.id}><span className="company-monogram">{user.nome.split(" ").map((part) => part[0]).slice(0,2).join("")}</span><span><strong>{user.nome}</strong><small>{user.email}</small></span>{isAdmin ? <Button onClick={() => void handleApproveUser(user.id)}>Ativar conta</Button> : null}</div>)}<div className="pending-access"><span><KeyRound size={17} /></span><div><strong>Convite obrigatório</strong><p>São aceites contas Google empresariais ou @gmail.com, mas apenas se um administrador as tiver convidado.</p></div><span className="mono">{pendingUsers.length} pendentes</span></div></> : null}
          {section === "goals" ? <><div className="settings-header"><div><p className="eyebrow">Modelo comercial</p><h2>Objetivos e probabilidades</h2><p>Valores usados pelo pipeline ponderado e pela cobertura.</p></div>{saved ? <span className="saved-label"><Check size={15} />Guardado</span> : <Button onClick={handleSaveCommercialSettings}><Save size={15} />Guardar alterações</Button>}</div><div className="goal-grid"><label>Objetivo anual de faturação<input className="mono" type="number" value={goals.annual} onChange={(event) => setGoals((current) => ({ ...current, annual: Number(event.target.value) }))} /></label><label>Objetivo mensal atual<input className="mono" type="number" value={goals.monthly} onChange={(event) => setGoals((current) => ({ ...current, monthly: Number(event.target.value) }))} /></label><label>Objetivo mensal de reuniões<input className="mono" type="number" value={goals.meetings} onChange={(event) => setGoals((current) => ({ ...current, meetings: Number(event.target.value) }))} /></label><label>Objetivo mensal de propostas<input className="mono" type="number" value={goals.proposals} onChange={(event) => setGoals((current) => ({ ...current, proposals: Number(event.target.value) }))} /></label></div><h3 className="settings-subtitle">Probabilidade por estado</h3><div className="probability-list">{stageOrder.map((stage, index) => <div key={stage}><span className="mono">0{index + 1}</span><strong>{stageLabels[stage]}</strong><input type="range" min="0" max="100" value={probabilities[stage] ?? stageProbability[stage]} onChange={(event) => setProbabilities((current) => ({ ...current, [stage]: Number(event.target.value) }))} /><b className="mono">{probabilities[stage] ?? stageProbability[stage]}%</b></div>)}</div></> : null}
          {section === "security" ? <><div className="settings-header"><div><p className="eyebrow">Defesa em profundidade</p><h2>Segurança</h2><p>Convites, OAuth, RLS, sessões e registo de operações sensíveis.</p></div><span className="security-grade"><ShieldCheck size={17} />Protegido</span></div><div className="security-list"><div><span><KeyRound size={18} /></span><div><strong>Autenticação por convite</strong><p>Magic link para o endereço aprovado; a conta Google autorizada tem de corresponder ao login.</p></div><b>Ativo</b></div><div><span><Database size={18} /></span><div><strong>Row Level Security</strong><p>Ativa em todas as tabelas. A service role e os refresh tokens nunca chegam ao cliente.</p></div><b>Ativo</b></div><div><span><ShieldCheck size={18} /></span><div><strong>{localBackend ? "Servidor local" : "Servidor self-hosted"}</strong><p>{localBackend ? "A API está limitada a este Mac. TLS público, backups e recuperação ficam pendentes até à passagem para o servidor." : "Postgres isolado na rede privada; gateway público protegido por TLS."}</p></div><b>{localBackend ? "Local" : "Ativo"}</b></div></div></> : null}
          {section === "gmail" ? <><div className="settings-header"><div><p className="eyebrow">Google Workspace</p><h2>Integração Google</h2><p>Uma autorização segura importa o histórico Gmail, os contactos guardados e as reuniões do Calendar, sempre sem duplicar emails.</p></div>{gmailConnected ? <span className="saved-label"><Check size={15} />Ligado</span> : null}</div><div className="integration-card"><div className="gmail-mark">G</div><div><strong>{team.find((owner) => owner.id === currentUserId)?.email ?? "Conta Nikufra"}</strong><p>{gmailConnected ? gmailStatus?.backfill_complete && gmailStatus.people_sync_token && gmailStatus.other_contacts_sync_token && gmailStatus.calendar_sync_token ? "Histórico, contactos e calendário sincronizados; atualização incremental a cada 15 minutos." : "A importar Gmail, Google Contacts e Calendar em lotes seguros." : "Liga a conta Google para importar emails, contactos e reuniões."}</p><span>gmail.readonly</span><span>contacts.readonly</span><span>calendar.events.readonly</span><span>gmail.compose</span></div><div className="integration-actions"><Button variant="secondary" disabled={gmailBusy} onClick={handleConnectGmail}>{gmailBusy ? "A processar…" : gmailConnected ? "Voltar a autorizar" : "Ligar conta Google"}</Button>{gmailConnected ? <Button disabled={gmailBusy} onClick={() => void handleSyncGmail()}>Sincronizar agora</Button> : null}</div></div>{gmailStatus ? <div className="gmail-progress"><span><small>Mensagens associadas</small><strong className="mono">{gmailStatus.messages_synced.toLocaleString("pt-PT")}</strong></span><span><small>Contactos Google lidos</small><strong className="mono">{gmailStatus.people_contacts_synced.toLocaleString("pt-PT")}</strong></span><span><small>Contactos criados</small><strong className="mono">{gmailStatus.contacts_created.toLocaleString("pt-PT")}</strong></span><span><small>Reuniões Calendar</small><strong className="mono">{gmailStatus.calendar_events_synced.toLocaleString("pt-PT")}</strong></span><span><small>Última execução</small><strong>{gmailStatus.last_sync_at ? new Date(gmailStatus.last_sync_at).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "Ainda não executada"}</strong></span><span><small>Estado geral</small><strong>{gmailStatus.backfill_complete && gmailStatus.people_sync_token && gmailStatus.other_contacts_sync_token && gmailStatus.calendar_sync_token ? "Concluído" : "Em curso"}</strong></span></div> : null}{!supabase ? <div className="auth-error">API indisponível neste servidor local. É necessário configurar o Supabase e as credenciais OAuth Google no backend.</div> : null}{gmailStatus?.sync_error ? <div className="auth-error">Último erro: {gmailStatus.sync_error}. Se a conta foi ligada antes desta atualização, usa “Voltar a autorizar” para conceder Contacts e Calendar.</div> : null}{gmailError ? <div className="auth-error">{gmailError}</div> : null}<div className="integration-note"><ShieldCheck size={18} /><span><strong>Leitura abrangente sem guardar corpos completos.</strong> O CRM percorre todas as mensagens disponíveis, Google Contacts, “Outros contactos” e eventos do calendário principal. Guarda apenas identidade, contacto, assunto, data e excerto curto; os rascunhos continuam a exigir envio manual.</span></div></> : null}
          {section === "claude" ? <><div className="settings-header"><div><p className="eyebrow">Model Context Protocol</p><h2>Claude MCP</h2><p>Usa dados reais do CRM em conversas no Claude, com autorização individual e permissões da tua conta.</p></div><span className="security-grade"><ShieldCheck size={17} />Só leitura</span></div><div className="integration-card claude-integration-card"><div className="claude-mark"><Bot size={19} /></div><div><strong>Nikufra CRM</strong><p>Pesquisa empresas, consulta fichas, analisa o pipeline e obtém sugestões de follow-up diretamente no Claude.</p><code>{window.location.origin}/functions/v1/mcp</code></div><div className="integration-actions"><Button onClick={() => void handleOpenClaudeConnectors()}>{mcpCopied ? <Check size={15} /> : <ExternalLink size={15} />}{mcpCopied ? "Endereço copiado" : "Abrir conectores no Claude"}</Button><Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/functions/v1/mcp`); setMcpCopied(true); window.setTimeout(() => setMcpCopied(false), 3000); }}><Copy size={14} />Copiar endereço</Button></div></div><div className="mcp-steps"><div><b>1</b><span><strong>Abre os conectores</strong><small>O endereço MCP fica copiado automaticamente.</small></span></div><div><b>2</b><span><strong>Adiciona um conector personalizado</strong><small>Cola o endereço “Nikufra CRM” no Claude.</small></span></div><div><b>3</b><span><strong>Autoriza a tua conta</strong><small>Regressas ao Claude e a ligação fica guardada nessa conta.</small></span></div></div><div className="integration-note"><Bot size={18} /><span><strong>Limitação conhecida:</strong> as perguntas e respostas deste modo acontecem no Claude. O conector não permite que a subscrição Claude responda às menções no chat interno do CRM; essa funcionalidade continua a necessitar da API Anthropic. Nesta primeira versão, o MCP é deliberadamente só de leitura.</span></div></> : null}
          {section === "data" ? <><div className="settings-header"><div><p className="eyebrow">Privacidade</p><h2>Dados e RGPD</h2><p>Exporta ou elimina definitivamente os dados de um contacto.</p></div></div><div className="rgpd-search"><input placeholder="Pesquisar contacto por email..." /><Button>Pesquisar</Button></div><div className="integration-note"><Database size={18} /><span><strong>Backups locais diários verificados.</strong> Retenção automática de 31 dias e 12 meses no servidor privado; uma cópia externa continua recomendada para recuperação de desastre.</span></div></> : null}
        </Card>
      </div>
      <Modal open={inviteOpen} onClose={() => { if (!inviteBusy) setInviteOpen(false); }} title="Convidar utilizador" description="Aceita Google Workspace ou @gmail.com. O endereço autorizado será o único que pode criar a conta."><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void handleInvite(event.currentTarget); }}><label>Nome<input name="nome" minLength={2} maxLength={120} required autoFocus disabled={inviteBusy} /></label><label>Email Google<input name="email" type="email" maxLength={320} required placeholder="nome@gmail.com" disabled={inviteBusy} /></label>{inviteNotice ? <div className={inviteNotice.kind === "success" ? "success-banner" : "auth-error"} role={inviteNotice.kind === "error" ? "alert" : "status"} aria-live="polite">{inviteNotice.text}</div> : null}<div className="modal__actions"><Button type="button" variant="secondary" disabled={inviteBusy} onClick={() => setInviteOpen(false)}>Fechar</Button><Button type="submit" disabled={inviteBusy}>{inviteBusy ? "A enviar…" : "Enviar convite"}</Button></div></form></Modal>
    </div>
  );
}
