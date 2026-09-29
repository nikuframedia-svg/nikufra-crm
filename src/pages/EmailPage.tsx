import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, ChevronRight, Clock3, ExternalLink, FilePenLine, Inbox, MailCheck, Plus, RefreshCw, Search, Send, Sparkles, Users } from "lucide-react";
import { useCRM } from "../state/crm-context";
import { supabase } from "../lib/supabase";
import { renderDraftTemplate } from "../lib/email-draft";
import { formatPercentage } from "../lib/format";
import type { Draft } from "../types";
import { Button, Card, PageHeader, StageChip } from "../components/ui";

const templates = [
  { name: "Primeiro contacto industrial", subject: "{{empresa}} × Nikufra — uma hipótese concreta", body: "Olá {{nome}},\n\nTenho acompanhado o trabalho da {{empresa}} em {{vertical}}. Na Nikufra ajudamos fabricantes a transformar dados de ERP, MES e chão de fábrica em decisões operacionais mais rápidas.\n\nFaz sentido uma conversa de 20 minutos para perceber se existe um caso concreto?\n\nCumprimentos,\n{{remetente}}" },
  { name: "Follow-up de reunião", subject: "Próximos passos — Nikufra × {{empresa}}", body: "Olá {{nome}},\n\nObrigado pela conversa. Deixo abaixo os próximos passos que alinhámos e o contexto técnico relevante.\n\nCumprimentos,\n{{remetente}}" },
  { name: "Reativação", subject: "Retomar o tema de dados na {{empresa}}", body: "Olá {{nome}},\n\nRetomo o nosso contacto porque o contexto que discutimos pode ter mudado. Há disponibilidade para revermos o tema este mês?\n\nCumprimentos,\n{{remetente}}" },
];

export function EmailPage() {
  const { leads, drafts, addDrafts, activities, dataMode, team, currentUserId, emailSelection, setEmailSelection } = useCRM();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(emailSelection));
  const [templateIndex, setTemplateIndex] = useState(0);
  const [subject, setSubject] = useState(templates[0].subject);
  const [body, setBody] = useState(templates[0].body);
  const [sent, setSent] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const eligible = useMemo(() => leads.filter((lead) => !lead.optout && Boolean(lead.email) && `${lead.nome} ${lead.empresa}`.toLowerCase().includes(search.toLowerCase())), [leads, search]);
  const { data: recentEmailActivities = [], refetch: refetchRecentEmails } = useQuery({
    queryKey: ["recent-email-activities"],
    enabled: Boolean(supabase),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error: queryError } = await supabase!.from("atividades")
        .select("id,tipo,descricao,data,direcao,reuniao_inferida,assunto,snippet,empresas(nome),contactos(nome,email)")
        .in("tipo", ["email_enviado", "email_recebido"])
        .order("data", { ascending: false })
        .limit(60);
      if (queryError) throw queryError;
      return (data ?? []).map((row) => {
        const company = Array.isArray(row.empresas) ? row.empresas[0] : row.empresas;
        const contact = Array.isArray(row.contactos) ? row.contactos[0] : row.contactos;
        return { id: row.id, company: company?.nome ?? "Empresa", person: contact?.nome ?? contact?.email ?? "Contacto", subject: row.assunto ?? row.descricao, snippet: row.snippet ?? (row.direcao === "recebido" ? "Email recebido" : "Email enviado"), meeting: row.reuniao_inferida, time: new Date(row.data).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }), unread: row.direcao === "recebido" };
      });
    },
  });
  const { data: gmailStatus } = useQuery({
    queryKey: ["gmail-email-status", currentUserId],
    enabled: Boolean(supabase),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error: statusError } = await supabase!.from("google_tokens").select("messages_synced,last_sync_at").eq("user_id", currentUserId).maybeSingle();
      if (statusError) throw statusError;
      return data;
    },
  });
  const fallbackThreads = activities.filter((activity) => activity.tipo === "email").slice(0, 60).map((activity) => ({ id: activity.id, company: activity.empresa, person: activity.contactoNome ?? activity.contactoEmail ?? "Contacto", subject: activity.assunto ?? activity.descricao, snippet: activity.snippet ?? (activity.direcao === "recebido" ? "Email recebido" : "Email enviado"), meeting: activity.reuniaoInferida, time: new Date(activity.data).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }), unread: activity.direcao === "recebido" }));
  const visibleThreads = (recentEmailActivities.length ? recentEmailActivities : fallbackThreads).slice(0, 20);
  const currentOwner = team.find((owner) => owner.id === currentUserId) ?? team[0];
  const currentEmail = currentOwner?.email ?? "Conta Google não identificada";
  const sentEmails = activities.filter((activity) => activity.tipo === "email" && activity.direcao === "enviado");
  const repliedContacts = new Set(activities.filter((activity) => activity.tipo === "email" && activity.direcao === "recebido").map((activity) => activity.contactoId).filter(Boolean));
  const contacted = new Set(sentEmails.map((activity) => activity.contactoId).filter(Boolean));
  const replyRate = contacted.size ? 100 * [...repliedContacts].filter((id) => contacted.has(id)).length / contacted.size : null;
  const previewLead = eligible.find((lead) => selected.has(lead.id));

  function chooseTemplate(index: number) { setTemplateIndex(index); setSubject(templates[index].subject); setBody(templates[index].body); setSent(false); }
  function renderTemplate(text: string, lead: typeof leads[number]) {
    return renderDraftTemplate(text, lead, currentOwner?.nome);
  }
  function handleOpenGmail() {
    window.open("https://mail.google.com/mail/u/0/#drafts", "_blank", "noopener,noreferrer");
  }
  async function handleGenerate() {
    setGenerating(true); setError(""); setSent(false);
    const selectedLeads = eligible.filter((lead) => selected.has(lead.id));
    const newDrafts: Draft[] = selectedLeads.map((lead) => ({ id: crypto.randomUUID(), destinatario: lead.email, empresa: lead.empresa, assunto: renderTemplate(subject, lead), mensagem: renderTemplate(body, lead), criadoEm: "Agora" }));
    if (supabase) {
      const { error: functionError } = await supabase.functions.invoke("gmail-drafts", { body: { drafts: selectedLeads.map((lead, index) => ({ contactoId: lead.id, destinatario: lead.email, assunto: newDrafts[index].assunto, mensagem: newDrafts[index].mensagem })) } });
      if (functionError) { setError(functionError.message); setGenerating(false); return; }
    }
    addDrafts(newDrafts); setEmailSelection([]); setSent(true); setGenerating(false);
  }
  async function handleSyncGmail() {
    if (!supabase) return;
    setSyncing(true); setError("");
    try {
      const { error: syncError } = await supabase.functions.invoke("gmail-sync", { body: {} });
      if (syncError) throw syncError;
      await Promise.all([refetchRecentEmails(), queryClient.invalidateQueries({ queryKey: ["google-team-calendar"] })]);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Falha ao sincronizar Gmail");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="page">
      <PageHeader eyebrow={dataMode === "supabase" ? "Histórico Gmail" : "Dados locais"} title="Email e rascunhos" description="Lê metadados das conversas, personaliza templates e cria rascunhos. O envio é sempre manual no Gmail." actions={<><Button variant="secondary" disabled={syncing} onClick={() => void handleSyncGmail()}><RefreshCw size={16} className={syncing ? "spin" : ""} />{syncing ? "A sincronizar…" : "Sincronizar"}</Button><Button variant="secondary" onClick={() => void handleOpenGmail()}><ExternalLink size={16} />Abrir Gmail</Button></>} />
      <div className="mail-status"><span>{dataMode === "supabase" ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}{currentEmail}</span><span>{dataMode === "supabase" ? `${Number(gmailStatus?.messages_synced ?? 0).toLocaleString("pt-PT")} emails associados` : "A sincronização Gmail requer o servidor configurado"}</span><span><Clock3 size={14} />Atualização automática a cada 15 min</span><b>gmail.readonly + gmail.compose</b></div>
      <div className="email-layout">
        <Card className="inbox-panel">
          <div className="panel-header"><div><p className="eyebrow">Histórico indexado</p><h2>Conversas recentes</h2></div><span className="counter">{visibleThreads.filter((thread) => thread.unread).length}</span></div>
          <div className="inbox-list">{visibleThreads.length ? visibleThreads.map((thread) => <button key={thread.id} className={thread.unread ? "is-unread" : ""}><span className="company-monogram">{thread.company.slice(0, 2).toUpperCase()}</span><span><strong>{thread.company}<small>{thread.time}</small></strong><b>{thread.subject}</b><p>{thread.person} · {thread.snippet}{thread.meeting ? " · possível reunião" : ""}</p></span><ChevronRight size={15} /></button>) : <div className="empty-state">Ainda não existem emails reais indexados. Liga ou sincroniza o Gmail nas Definições.</div>}</div>
          <button className="panel-link"><Inbox size={15} />Ver toda a caixa de entrada</button>
        </Card>

        <Card className="composer-panel">
          <div className="panel-header"><div><p className="eyebrow">Composição assistida</p><h2>Criar rascunhos</h2></div><span className="safe-label"><MailCheck size={14} />Nunca envia automaticamente</span></div>
          <div className="composer-grid">
            <section className="recipient-picker">
              <div className="section-label"><span>1</span><strong>Destinatários</strong><b>{selected.size} selecionados</b></div>
              <div className="table-search table-search--compact"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar contactos" /></div>
              <label className="select-all"><input type="checkbox" checked={selected.size === eligible.length && eligible.length > 0} onChange={(event) => setSelected(event.target.checked ? new Set(eligible.map((lead) => lead.id)) : new Set())} />Selecionar {eligible.length} elegíveis<span>{leads.filter((lead) => lead.optout).length} opt-out excluídos</span></label>
              <div className="recipient-list">{eligible.slice(0, 9).map((lead) => <label key={lead.id}><input type="checkbox" checked={selected.has(lead.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(lead.id) : next.delete(lead.id); return next; })} /><span className="company-monogram">{lead.nome.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{lead.nome}</strong><small>{lead.empresa}</small></span><StageChip stage={lead.estado} /></label>)}</div>
            </section>
            <section className="message-editor">
              <div className="section-label"><span>2</span><strong>Mensagem</strong><b><Sparkles size={13} />Variáveis ativas</b></div>
              <label>Template<select value={templateIndex} onChange={(event) => chooseTemplate(Number(event.target.value))}>{templates.map((template, index) => <option key={template.name} value={index}>{template.name}</option>)}</select></label>
              <label>Assunto<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
              <label>Mensagem<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={11} /></label>
              <div className="variable-row"><button>{"{{nome}}"}</button><button>{"{{empresa}}"}</button><button>{"{{vertical}}"}</button><button>{"{{remetente}}"}</button></div>
              {previewLead ? <div className="draft-preview"><div><span>Pré-visualização</span><small>{previewLead.email}</small></div><strong>{renderTemplate(subject, previewLead)}</strong><pre>{renderTemplate(body, previewLead)}</pre></div> : null}
              {sent ? <div className="success-banner"><CheckCircle2 size={17} /><span><strong>{selected.size} rascunhos criados.</strong> Revê e envia cada um no Gmail.</span></div> : null}
              {error ? <div className="auth-error">{error}. Confirma a ligação Gmail nas definições.</div> : null}
              <Button className="generate-button" disabled={!selected.size || generating} onClick={handleGenerate}><FilePenLine size={16} />{generating ? "A criar rascunhos…" : `Criar ${selected.size || ""} rascunhos`}</Button>
            </section>
          </div>
        </Card>

        <Card className="drafts-panel">
          <div className="panel-header"><div><p className="eyebrow">Preparados</p><h2>Rascunhos recentes</h2></div><button className="icon-button"><Plus size={16} /></button></div>
          <div className="draft-list">{drafts.slice(0, 6).map((draft) => <button key={draft.id}><span className="draft-icon"><FilePenLine size={15} /></span><span><strong>{draft.empresa}</strong><b>{draft.assunto}</b><small>{draft.criadoEm} · {draft.destinatario}</small></span><Send size={14} /></button>)}</div>
          <div className="draft-footer"><span><Archive size={14} />{drafts.length} rascunhos</span><span><Users size={14} />{replyRate === null ? "Taxa de resposta sem amostra" : `Taxa de resposta ${formatPercentage(replyRate)}`}</span></div>
        </Card>
      </div>
    </div>
  );
}
