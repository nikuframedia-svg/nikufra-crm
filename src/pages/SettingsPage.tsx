import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { Check, ChevronRight, Database, KeyRound, Mail, Save, ShieldCheck, SlidersHorizontal, UserCheck, Users } from "lucide-react";
import { stageLabels, stageOrder, stageProbability } from "../data/seed";
import { useCRM } from "../state/crm-context";
import { supabase } from "../lib/supabase";
import { Avatar, Button, Card, Modal, PageHeader } from "../components/ui";

export function SettingsPage() {
  const { team, currentUserId } = useCRM();
  const [section, setSection] = useState("users");
  const [saved, setSaved] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailError, setGmailError] = useState("");
  const [gmailStatus, setGmailStatus] = useState<{ backfill_complete: boolean; messages_synced: number; contacts_created: number; last_sync_at: string | null; sync_error: string | null } | null>(null);
  const [probabilities, setProbabilities] = useState<Record<string, number>>(() => ({ ...stageProbability }));
  const [goals, setGoals] = useState({ annual: 0, monthly: 0, meetings: 0, proposals: 0 });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [pendingUsers, setPendingUsers] = useState<Array<{ id: string; nome: string; email: string }>>([]);

  const now = new Date(); const currentYear = now.getFullYear(); const currentMonth = now.getMonth() + 1;

  async function loadGmailStatus() {
    if (!supabase) return;
    const { data } = await supabase.from("google_tokens").select("backfill_complete,messages_synced,contacts_created,last_sync_at,sync_error").eq("user_id", currentUserId).maybeSingle();
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
      if (supabase) void supabase.functions.invoke("gmail-sync", { body: {} }).then(() => loadGmailStatus());
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

  function handleRoleChange(ownerId: string, role: "admin" | "member") {
    if (supabase) void supabase.from("profiles").update({ role }).eq("id", ownerId);
  }

  async function handleInvite(formData: FormData) {
    if (!supabase) { setInviteMessage("O servidor não está configurado neste ambiente; nenhum convite foi enviado."); return; }
    const { error } = await supabase.functions.invoke("invite-user", { body: { nome: String(formData.get("nome")), email: String(formData.get("email")) } });
    setInviteMessage(error ? error.message : "Convite enviado. A conta ficará inativa até aprovação.");
  }

  async function handleApproveUser(userId: string) {
    if (supabase) {
      const { error } = await supabase.from("profiles").update({ ativo: true }).eq("id", userId);
      if (error) return;
    }
    setPendingUsers((current) => current.filter((user) => user.id !== userId));
  }

  async function handleConnectGmail() {
    if (!supabase) return;
    setGmailBusy(true); setGmailError("");
    const { data, error } = await supabase.functions.invoke("gmail-oauth-start", { body: {} });
    if (error || !data?.url) { setGmailError(error?.message ?? "Não foi possível iniciar o OAuth"); setGmailBusy(false); return; }
    try {
      if ("__TAURI_INTERNALS__" in window) await open(data.url);
      else window.open(data.url, "_blank", "noopener,noreferrer");
    } catch { window.open(data.url, "_blank", "noopener,noreferrer"); }
    setGmailBusy(false);
  }
  async function handleSyncGmail() {
    if (!supabase) return;
    setGmailBusy(true); setGmailError("");
    const { error } = await supabase.functions.invoke("gmail-sync", { body: {} });
    if (error) setGmailError(error.message);
    await loadGmailStatus(); setGmailBusy(false);
  }
  return (
    <div className="page">
      <PageHeader eyebrow="Administração" title="Definições" description="Utilizadores, objetivos, probabilidades e integrações. Alterações sensíveis ficam em audit log." />
      <div className="settings-layout">
        <Card className="settings-nav">{[
          ["users", Users, "Utilizadores", "Contas e permissões"],
          ["goals", SlidersHorizontal, "Objetivos e funil", "Metas e probabilidades"],
          ["security", ShieldCheck, "Segurança", "Sessões e autenticação"],
          ["gmail", Mail, "Integração Gmail", "OAuth e sincronização"],
          ["data", Database, "Dados e RGPD", "Exportação e retenção"],
        ].map(([id, Icon, label, detail]) => <button key={String(id)} className={section === id ? "is-active" : ""} onClick={() => setSection(String(id))}><Icon size={17} /><span><strong>{String(label)}</strong><small>{String(detail)}</small></span><ChevronRight size={15} /></button>)}</Card>
        <Card className="settings-content">
          {section === "users" ? <><div className="settings-header"><div><p className="eyebrow">Acesso partilhado</p><h2>Utilizadores</h2><p>Qualquer conta nova fica inativa até aprovação de um administrador.</p></div><Button onClick={() => { setInviteOpen(true); setInviteMessage(""); }}><UserCheck size={16} />Convidar por email</Button></div><div className="user-list">{team.map((owner) => <div key={owner.id}><Avatar ownerId={owner.id} size="md" /><span><strong>{owner.nome}{owner.id === currentUserId ? <em>Tu</em> : null}</strong><small>{owner.email}</small></span><span className="user-status"><i />Ativo</span><select defaultValue={owner.role} onChange={(event) => handleRoleChange(owner.id, event.target.value as "admin" | "member")}><option value="admin">Administrador</option><option value="member">Membro</option></select><button className="icon-button"><ChevronRight size={15} /></button></div>)}</div>{pendingUsers.map((user) => <div className="pending-user" key={user.id}><span className="company-monogram">{user.nome.split(" ").map((part) => part[0]).slice(0,2).join("")}</span><span><strong>{user.nome}</strong><small>{user.email}</small></span><Button onClick={() => void handleApproveUser(user.id)}>Ativar conta</Button></div>)}<div className="pending-access"><span><KeyRound size={17} /></span><div><strong>Aprovação obrigatória</strong><p>Novos utilizadores @nikufra.ai podem pedir acesso, mas não leem dados antes de aprovação.</p></div><span className="mono">{pendingUsers.length} pendentes</span></div></> : null}
          {section === "goals" ? <><div className="settings-header"><div><p className="eyebrow">Modelo comercial</p><h2>Objetivos e probabilidades</h2><p>Valores usados pelo pipeline ponderado e pela cobertura.</p></div>{saved ? <span className="saved-label"><Check size={15} />Guardado</span> : <Button onClick={handleSaveCommercialSettings}><Save size={15} />Guardar alterações</Button>}</div><div className="goal-grid"><label>Objetivo anual de faturação<input className="mono" type="number" value={goals.annual} onChange={(event) => setGoals((current) => ({ ...current, annual: Number(event.target.value) }))} /></label><label>Objetivo mensal atual<input className="mono" type="number" value={goals.monthly} onChange={(event) => setGoals((current) => ({ ...current, monthly: Number(event.target.value) }))} /></label><label>Objetivo mensal de reuniões<input className="mono" type="number" value={goals.meetings} onChange={(event) => setGoals((current) => ({ ...current, meetings: Number(event.target.value) }))} /></label><label>Objetivo mensal de propostas<input className="mono" type="number" value={goals.proposals} onChange={(event) => setGoals((current) => ({ ...current, proposals: Number(event.target.value) }))} /></label></div><h3 className="settings-subtitle">Probabilidade por estado</h3><div className="probability-list">{stageOrder.map((stage, index) => <div key={stage}><span className="mono">0{index + 1}</span><strong>{stageLabels[stage]}</strong><input type="range" min="0" max="100" value={probabilities[stage] ?? stageProbability[stage]} onChange={(event) => setProbabilities((current) => ({ ...current, [stage]: Number(event.target.value) }))} /><b className="mono">{probabilities[stage] ?? stageProbability[stage]}%</b></div>)}</div></> : null}
          {section === "security" ? <><div className="settings-header"><div><p className="eyebrow">Defesa em profundidade</p><h2>Segurança</h2><p>Magic links, RLS, sessões e registo de acesso.</p></div><span className="security-grade"><ShieldCheck size={17} />Protegido</span></div><div className="security-list"><div><span><KeyRound size={18} /></span><div><strong>Autenticação sem palavra-passe</strong><p>Magic links limitados ao domínio @nikufra.ai. Sessões renovadas automaticamente.</p></div><b>Ativo</b></div><div><span><Database size={18} /></span><div><strong>Row Level Security</strong><p>Ativa em todas as tabelas. O cliente nunca recebe a service role key.</p></div><b>Ativo</b></div><div><span><ShieldCheck size={18} /></span><div><strong>Servidor self-hosted</strong><p>Postgres apenas na rede privada; gateway público via TLS 1.3.</p></div><b>Ativo</b></div></div></> : null}
          {section === "gmail" ? <><div className="settings-header"><div><p className="eyebrow">Google Workspace</p><h2>Integração Gmail</h2><p>Depois do consentimento de cada utilizador, o CRM percorre todo o histórico disponível e elimina duplicados por email.</p></div>{gmailConnected ? <span className="saved-label"><Check size={15} />Ligado</span> : null}</div><div className="integration-card"><div className="gmail-mark">M</div><div><strong>{team.find((owner) => owner.id === currentUserId)?.email ?? "Conta Nikufra"}</strong><p>{gmailConnected ? gmailStatus?.backfill_complete ? "Histórico inicial concluído; sincronização incremental a cada 15 minutos." : "A importar o histórico Gmail em lotes seguros." : "Liga a tua caixa de correio para iniciar a sincronização."}</p><span>gmail.readonly</span><span>gmail.compose</span></div><div className="integration-actions"><Button variant="secondary" disabled={gmailBusy} onClick={handleConnectGmail}>{gmailBusy ? "A processar…" : gmailConnected ? "Voltar a ligar" : "Ligar Gmail"}</Button>{gmailConnected ? <Button disabled={gmailBusy} onClick={() => void handleSyncGmail()}>Sincronizar agora</Button> : null}</div></div>{gmailStatus ? <div className="gmail-progress"><span><small>Mensagens associadas</small><strong className="mono">{gmailStatus.messages_synced.toLocaleString("pt-PT")}</strong></span><span><small>Contactos criados</small><strong className="mono">{gmailStatus.contacts_created.toLocaleString("pt-PT")}</strong></span><span><small>Última execução</small><strong>{gmailStatus.last_sync_at ? new Date(gmailStatus.last_sync_at).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "Ainda não executada"}</strong></span><span><small>Histórico</small><strong>{gmailStatus.backfill_complete ? "Concluído" : "Em curso"}</strong></span></div> : null}{gmailStatus?.sync_error ? <div className="auth-error">Último erro: {gmailStatus.sync_error}</div> : null}{gmailError ? <div className="auth-error">{gmailError}</div> : null}<div className="integration-note"><ShieldCheck size={18} /><span><strong>Sem envio automático e sem armazenar o corpo completo.</strong> Guardamos remetente, destinatário, assunto, data e um excerto curto para organizar contactos e sinais de reunião. Cada mensagem é revista e enviada manualmente no Gmail.</span></div></> : null}
          {section === "data" ? <><div className="settings-header"><div><p className="eyebrow">Privacidade</p><h2>Dados e RGPD</h2><p>Exporta ou elimina definitivamente os dados de um contacto.</p></div></div><div className="rgpd-search"><input placeholder="Pesquisar contacto por email..." /><Button>Pesquisar</Button></div><div className="integration-note"><Database size={18} /><span><strong>Backups diários verificados.</strong> 30 cópias diárias, 12 mensais e teste de restauro agendado.</span></div></> : null}
        </Card>
      </div>
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Convidar utilizador" description="O convite só aceita endereços @nikufra.ai."><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void handleInvite(new FormData(event.currentTarget)); }}><label>Nome<input name="nome" required autoFocus /></label><label>Email Nikufra<input name="email" type="email" required placeholder="nome@nikufra.ai" /></label>{inviteMessage ? <div className="success-banner">{inviteMessage}</div> : null}<div className="modal__actions"><Button type="button" variant="secondary" onClick={() => setInviteOpen(false)}>Fechar</Button><Button type="submit">Enviar convite</Button></div></form></Modal>
    </div>
  );
}
