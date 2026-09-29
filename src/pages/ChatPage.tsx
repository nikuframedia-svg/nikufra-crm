import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Bot, Check, ChevronRight, Hash, Loader2, LockKeyhole, MessageCircle, MessageSquarePlus, Plus, Search, Send, Settings2, UserPlus, Users, X } from "lucide-react";
import { Button, Modal } from "../components/ui";
import { chatConversationInitials, chatConversationTitle, formatChatTime, mentionedAgentIds, mergeChatMessage, type ChatAgent, type ChatConversation, type ChatConversationAgent, type ChatMember, type ChatMessage } from "../lib/chat";
import { supabase } from "../lib/supabase";
import { useCRM } from "../state/crm-context";

type McpDraft = { id: string; nome: string; url: string; authorizationToken: string };

const EMPTY_MCP = (): McpDraft => ({ id: crypto.randomUUID(), nome: "", url: "", authorizationToken: "" });

export function ChatPage() {
  const { team, currentUserId, dataMode } = useCRM();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const [conversationAgents, setConversationAgents] = useState<ChatConversationAgent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [agentThinking, setAgentThinking] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [configureAgentOpen, setConfigureAgentOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [mcpDrafts, setMcpDrafts] = useState<McpDraft[]>([EMPTY_MCP()]);
  const messageEndRef = useRef<HTMLDivElement>(null);

  const currentUser = team.find((person) => person.id === currentUserId);
  const currentConversation = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const currentMembers = useMemo(() => members.filter((member) => member.conversationId === selectedId), [members, selectedId]);
  const currentConversationAgents = useMemo(() => conversationAgents.filter((item) => item.conversationId === selectedId && item.ativo).map((item) => agents.find((agent) => agent.id === item.agentId)).filter((agent): agent is ChatAgent => Boolean(agent)), [agents, conversationAgents, selectedId]);
  const canManageCurrent = Boolean(currentConversation && (currentConversation.createdBy === currentUserId || currentUser?.role === "admin"));

  const loadConversations = useCallback(async (preferredId?: string) => {
    if (!supabase) { setLoading(false); return; }
    const [conversationsResult, membersResult, agentsResult, conversationAgentsResult] = await Promise.all([
      supabase.from("chat_conversations").select("id,kind,nome,descricao,privado,created_by,last_message_at,created_at").order("last_message_at", { ascending: false }),
      supabase.from("chat_conversation_members").select("conversation_id,user_id,role,last_read_at"),
      supabase.from("chat_agents").select("id,nome,descricao,provider,model,instrucoes,ativo").eq("ativo", true).order("nome"),
      supabase.from("chat_conversation_agents").select("conversation_id,agent_id,ativo").eq("ativo", true),
    ]);
    const firstError = conversationsResult.error ?? membersResult.error ?? agentsResult.error ?? conversationAgentsResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const nextConversations: ChatConversation[] = (conversationsResult.data ?? []).map((row) => ({ id: row.id, kind: row.kind, nome: row.nome, descricao: row.descricao, privado: row.privado, createdBy: row.created_by, lastMessageAt: row.last_message_at, createdAt: row.created_at }));
    setConversations(nextConversations);
    setMembers((membersResult.data ?? []).map((row) => ({ conversationId: row.conversation_id, userId: row.user_id, role: row.role, lastReadAt: row.last_read_at })));
    setAgents((agentsResult.data ?? []).map((row) => ({ id: row.id, nome: row.nome, descricao: row.descricao, provider: row.provider, model: row.model, instrucoes: row.instrucoes, ativo: row.ativo })));
    setConversationAgents((conversationAgentsResult.data ?? []).map((row) => ({ conversationId: row.conversation_id, agentId: row.agent_id, ativo: row.ativo })));
    setSelectedId((current) => {
      const target = preferredId ?? current;
      return target && nextConversations.some((conversation) => conversation.id === target) ? target : nextConversations[0]?.id ?? null;
    });
    setLoading(false);
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!supabase) return;
    const { data, error: loadError } = await supabase.from("chat_messages").select("id,conversation_id,sender_id,agent_id,parent_message_id,body,edited_at,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(300);
    if (loadError) { setError(loadError.message); return; }
    setMessages((data ?? []).map((row) => ({ id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, agentId: row.agent_id, parentMessageId: row.parent_message_id, body: row.body, editedAt: row.edited_at, createdAt: row.created_at })));
    await supabase.rpc("mark_chat_read", { p_conversation_id: conversationId });
  }, []);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const channel = client.channel("team-chat-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversations" }, () => void loadConversations())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversation_members" }, () => void loadConversations())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversation_agents" }, () => void loadConversations())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [loadConversations]);

  useEffect(() => {
    const client = supabase;
    if (!client || !selectedId) { setMessages([]); return; }
    void loadMessages(selectedId);
    const channel = client.channel(`team-chat-${selectedId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${selectedId}` }, () => { void loadMessages(selectedId); void loadConversations(selectedId); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [loadConversations, loadMessages, selectedId]);

  useEffect(() => { messageEndRef.current?.scrollIntoView({ block: "end" }); }, [messages, agentThinking]);

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return conversations.filter((conversation) => !normalized || chatConversationTitle(conversation, members, team, currentUserId).toLowerCase().includes(normalized));
  }, [conversations, currentUserId, members, query, team]);

  async function createConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setError("");
    const data = new FormData(event.currentTarget);
    const surface = String(data.get("surface"));
    const kind = surface === "channel" ? "channel" : selectedPeople.length === 1 ? "direct" : "group";
    if (!selectedPeople.length) { setError("Seleciona pelo menos uma pessoa."); return; }
    const { data: id, error: createError } = await supabase.rpc("create_chat_conversation", {
      p_kind: kind,
      p_nome: String(data.get("nome") || "") || null,
      p_descricao: String(data.get("descricao") || ""),
      p_member_ids: selectedPeople,
    });
    if (createError) { setError(createError.message); return; }
    setCreateOpen(false); setSelectedPeople([]);
    await loadConversations(String(id));
  }

  async function sendMessage() {
    const body = draft.trim();
    const client = supabase;
    if (!client || !selectedId || !body || sending) return;
    setSending(true); setError(""); setDraft("");
    const { data: inserted, error: insertError } = await client.from("chat_messages").insert({ conversation_id: selectedId, sender_id: currentUserId, agent_id: null, body }).select("id,conversation_id,sender_id,agent_id,parent_message_id,body,edited_at,created_at").single();
    if (insertError || !inserted) { setDraft(body); setError(insertError?.message ?? "Não foi possível enviar a mensagem."); setSending(false); return; }

    const insertedMessage: ChatMessage = {
      id: inserted.id,
      conversationId: inserted.conversation_id,
      senderId: inserted.sender_id,
      agentId: inserted.agent_id,
      parentMessageId: inserted.parent_message_id,
      body: inserted.body,
      editedAt: inserted.edited_at,
      createdAt: inserted.created_at,
    };
    setMessages((current) => mergeChatMessage(current, insertedMessage));
    setConversations((current) => current.map((conversation) => conversation.id === selectedId ? { ...conversation, lastMessageAt: inserted.created_at } : conversation));
    setSending(false);

    const mentioned = mentionedAgentIds(body, currentConversationAgents);
    if (mentioned.length) {
      setAgentThinking(mentioned);
      const results = await Promise.all(mentioned.map((agentId) => client.functions.invoke("chat-agent", { body: { conversationId: selectedId, messageId: inserted.id, agentId } })));
      const failed = results.find((result) => result.error || result.data?.error);
      if (failed) setError(failed.data?.error || failed.error?.message || "O agente não conseguiu responder.");
      setAgentThinking([]);
      await loadMessages(selectedId);
    }
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
  }

  async function addMembers() {
    if (!supabase || !selectedId || !selectedPeople.length) return;
    const { error: addError } = await supabase.rpc("add_chat_members", { p_conversation_id: selectedId, p_member_ids: selectedPeople });
    if (addError) { setError(addError.message); return; }
    setMembersOpen(false); setSelectedPeople([]); await loadConversations(selectedId);
  }

  async function attachAgent(agentId: string) {
    if (!supabase || !selectedId) return;
    const { error: attachError } = await supabase.rpc("attach_chat_agent", { p_conversation_id: selectedId, p_agent_id: agentId });
    if (attachError) { setError(attachError.message); return; }
    await loadConversations(selectedId);
  }

  async function configureAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const data = new FormData(event.currentTarget);
    const result = await supabase.functions.invoke("chat-agent-config", { body: {
      nome: String(data.get("nome")),
      descricao: String(data.get("descricao")),
      model: String(data.get("model")),
      instrucoes: String(data.get("instrucoes")),
      apiKey: String(data.get("apiKey")),
      mcpServers: mcpDrafts.filter((server) => server.nome.trim() || server.url.trim()).map(({ nome, url, authorizationToken }) => ({ nome, url, authorizationToken })),
    } });
    if (result.error || result.data?.error) { setError(result.data?.error || result.error?.message || "Não foi possível guardar o agente."); return; }
    if (selectedId && result.data?.agent?.id) await attachAgent(result.data.agent.id);
    setConfigureAgentOpen(false); setAgentsOpen(false); setMcpDrafts([EMPTY_MCP()]); await loadConversations(selectedId ?? undefined);
  }

  function togglePerson(id: string) {
    setSelectedPeople((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  const missingMembers = team.filter((person) => person.id !== currentUserId && !currentMembers.some((member) => member.userId === person.id));
  const unattachedAgents = agents.filter((agent) => !currentConversationAgents.some((item) => item.id === agent.id));

  return (
    <div className={`chat-page ${detailsOpen ? "chat-page--details" : ""}`}>
      <aside className="chat-rail">
        <div className="chat-rail__header"><div><strong>Conversas</strong><span>{conversations.length} ativas</span></div><button className="icon-button" onClick={() => { setSelectedPeople([]); setCreateOpen(true); }} aria-label="Nova conversa"><MessageSquarePlus size={17} /></button></div>
        <label className="chat-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar conversas" /></label>
        <div className="chat-section-label"><span>Canais e mensagens</span><Plus size={12} /></div>
        <div className="chat-conversation-list">
          {loading ? <div className="chat-list-status"><Loader2 className="spin" size={16} />A carregar</div> : null}
          {!loading && !filteredConversations.length ? <button className="chat-empty-list" onClick={() => setCreateOpen(true)}><MessageCircle size={20} /><strong>Cria a primeira conversa</strong><span>Abre um canal ou fala em privado com a equipa.</span></button> : null}
          {filteredConversations.map((conversation) => {
            const title = chatConversationTitle(conversation, members, team, currentUserId);
            const ownMembership = members.find((member) => member.conversationId === conversation.id && member.userId === currentUserId);
            const unread = Boolean(ownMembership && new Date(conversation.lastMessageAt) > new Date(ownMembership.lastReadAt));
            return <button key={conversation.id} className={`chat-conversation ${selectedId === conversation.id ? "chat-conversation--active" : ""}`} onClick={() => setSelectedId(conversation.id)}><span className="chat-conversation__mark">{conversation.kind === "channel" ? <Hash size={15} /> : chatConversationInitials(title)}</span><span><strong>{title}</strong><small>{conversation.kind === "channel" ? conversation.descricao || "Canal de equipa" : `${members.filter((member) => member.conversationId === conversation.id).length} membros`}</small></span>{unread ? <i aria-label="Mensagens por ler" /> : null}</button>;
          })}
        </div>
      </aside>

      <section className="chat-room">
        {currentConversation ? <>
          <header className="chat-room__header"><div><span className="chat-room__icon">{currentConversation.kind === "channel" ? <Hash size={18} /> : <MessageCircle size={18} />}</span><div><h1>{chatConversationTitle(currentConversation, members, team, currentUserId)}</h1><p>{currentConversation.descricao || `${currentMembers.length} membros · ${currentConversationAgents.length} agentes`}</p></div></div><button className={`icon-button ${detailsOpen ? "chat-details-active" : ""}`} onClick={() => setDetailsOpen((value) => !value)} aria-label="Detalhes da conversa"><Users size={17} /></button></header>
          <div className="chat-message-list" aria-live="polite">
            {!messages.length ? <div className="chat-room-empty"><span>{currentConversation.kind === "channel" ? <Hash size={22} /> : <MessageCircle size={22} />}</span><h2>Início da conversa</h2><p>Partilha contexto com a equipa. Para chamar um agente ligado, escreve <b>@nome do agente</b>.</p></div> : null}
            {messages.map((message, index) => {
              const person = message.senderId ? team.find((item) => item.id === message.senderId) : null;
              const agent = message.agentId ? agents.find((item) => item.id === message.agentId) : null;
              const authorName = person?.nome ?? agent?.nome ?? "Utilizador";
              const previous = messages[index - 1];
              const grouped = Boolean(previous && previous.senderId === message.senderId && previous.agentId === message.agentId && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 300_000);
              return <article key={message.id} className={`chat-message ${grouped ? "chat-message--grouped" : ""} ${agent ? "chat-message--agent" : ""}`}>{!grouped ? <span className="chat-message__avatar" style={{ "--avatar": person?.cor ?? "#2563eb" } as React.CSSProperties}>{agent ? <Bot size={15} /> : person?.iniciais ?? "N"}</span> : <span className="chat-message__time">{formatChatTime(message.createdAt)}</span>}<div>{!grouped ? <header><strong>{authorName}</strong>{agent ? <em>AGENTE</em> : null}<time dateTime={message.createdAt}>{formatChatTime(message.createdAt)}</time></header> : null}<p>{message.body}</p></div></article>;
            })}
            {agentThinking.map((agentId) => { const agent = agents.find((item) => item.id === agentId); return <div className="chat-agent-thinking" key={agentId}><span><Bot size={14} /></span><Loader2 className="spin" size={13} />{agent?.nome ?? "Agente"} está a trabalhar…</div>; })}
            <div ref={messageEndRef} />
          </div>
          <div className="chat-composer-wrap">
            {error ? <div className="chat-inline-error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar erro"><X size={13} /></button></div> : null}
            {currentConversationAgents.length ? <div className="chat-agent-shortcuts"><span>Agentes:</span>{currentConversationAgents.map((agent) => <button key={agent.id} onClick={() => setDraft((value) => `${value}${value && !value.endsWith(" ") ? " " : ""}@${agent.nome} `)}><Bot size={12} />@{agent.nome}</button>)}</div> : null}
            <div className="chat-composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKey} rows={2} placeholder={`Mensagem para ${chatConversationTitle(currentConversation, members, team, currentUserId)}`} aria-label="Mensagem" /><div><span><b>Enter</b> para enviar · <b>Shift + Enter</b> nova linha</span><Button onClick={() => void sendMessage()} disabled={!draft.trim() || sending}>{sending ? <Loader2 className="spin" size={15} /> : <Send size={15} />}Enviar</Button></div></div>
          </div>
        </> : <div className="chat-no-room"><MessageCircle size={28} /><h1>Chat da equipa</h1><p>Cria canais e conversas privadas para trabalhar com pessoas e agentes no mesmo contexto.</p><Button onClick={() => setCreateOpen(true)}><Plus size={15} />Nova conversa</Button></div>}
      </section>

      {detailsOpen && currentConversation ? <aside className="chat-details"><div className="chat-details__header"><strong>Detalhes</strong><button className="icon-button" onClick={() => setDetailsOpen(false)} aria-label="Fechar detalhes"><X size={16} /></button></div><section><div className="chat-details__title"><span>{currentConversation.kind === "channel" ? <Hash size={17} /> : <LockKeyhole size={16} />}</span><div><strong>{chatConversationTitle(currentConversation, members, team, currentUserId)}</strong><small>{currentConversation.kind === "channel" ? "Canal da equipa" : "Conversa privada"}</small></div></div>{currentConversation.descricao ? <p>{currentConversation.descricao}</p> : null}</section><section><header><strong>Membros</strong>{canManageCurrent ? <button onClick={() => { setSelectedPeople([]); setMembersOpen(true); }}><UserPlus size={14} />Adicionar</button> : null}</header><div className="chat-people-list">{currentMembers.map((member) => { const person = team.find((item) => item.id === member.userId); return person ? <div key={member.userId}><span className="avatar avatar--sm" style={{ "--avatar": person.cor } as React.CSSProperties}>{person.iniciais}</span><span><strong>{person.nome}{person.id === currentUserId ? " (tu)" : ""}</strong><small>{member.role === "owner" ? "Responsável" : person.email}</small></span></div> : null; })}</div></section><section><header><strong>Agentes</strong>{canManageCurrent ? <button onClick={() => setAgentsOpen(true)}><Bot size={14} />Gerir</button> : null}</header>{currentConversationAgents.length ? <div className="chat-agent-list">{currentConversationAgents.map((agent) => <div key={agent.id}><span><Bot size={15} /></span><div><strong>{agent.nome}</strong><small>{agent.model}{agent.descricao ? ` · ${agent.descricao}` : ""}</small></div><Check size={14} /></div>)}</div> : <div className="chat-details-empty"><Bot size={18} /><span>Nenhum agente neste canal.</span></div>}</section></aside> : null}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nova conversa" description="Cria um canal de equipa ou uma conversa privada." width="620px"><form className="form-stack" onSubmit={createConversation}><div className="chat-surface-choice"><label><input type="radio" name="surface" value="channel" defaultChecked /><span><Hash size={17} /><strong>Canal</strong><small>Um espaço com nome para um tema ou projeto.</small></span></label><label><input type="radio" name="surface" value="private" /><span><LockKeyhole size={16} /><strong>Privada</strong><small>Uma pessoa ou um grupo restrito.</small></span></label></div><label>Nome do canal ou grupo<input name="nome" placeholder="ex.: vendas, produto, Projeto Nelo" maxLength={80} /></label><label>Descrição<textarea name="descricao" rows={2} placeholder="Para que serve esta conversa?" maxLength={500} /></label><fieldset className="chat-member-picker"><legend>Membros</legend>{team.filter((person) => person.id !== currentUserId).map((person) => <label key={person.id}><input type="checkbox" checked={selectedPeople.includes(person.id)} onChange={() => togglePerson(person.id)} /><span className="avatar avatar--sm" style={{ "--avatar": person.cor } as React.CSSProperties}>{person.iniciais}</span><span><strong>{person.nome}</strong><small>{person.email}</small></span></label>)}</fieldset>{error ? <div className="auth-error">{error}</div> : null}<div className="modal__actions"><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button type="submit"><MessageSquarePlus size={15} />Criar conversa</Button></div></form></Modal>

      <Modal open={membersOpen} onClose={() => setMembersOpen(false)} title="Adicionar membros" description="Estas pessoas passam a ter acesso ao histórico completo." width="520px"><div className="form-stack"><fieldset className="chat-member-picker">{missingMembers.length ? missingMembers.map((person) => <label key={person.id}><input type="checkbox" checked={selectedPeople.includes(person.id)} onChange={() => togglePerson(person.id)} /><span className="avatar avatar--sm" style={{ "--avatar": person.cor } as React.CSSProperties}>{person.iniciais}</span><span><strong>{person.nome}</strong><small>{person.email}</small></span></label>) : <div className="empty-state">Toda a equipa já participa nesta conversa.</div>}</fieldset><div className="modal__actions"><Button variant="secondary" onClick={() => setMembersOpen(false)}>Cancelar</Button><Button onClick={() => void addMembers()} disabled={!selectedPeople.length}><UserPlus size={15} />Adicionar</Button></div></div></Modal>

      <Modal open={agentsOpen} onClose={() => setAgentsOpen(false)} title="Agentes da conversa" description="Tal como no Slack, um agente só vê as conversas onde foi adicionado." width="600px"><div className="chat-agent-manager">{unattachedAgents.length ? unattachedAgents.map((agent) => <div key={agent.id}><span><Bot size={16} /></span><div><strong>{agent.nome}</strong><small>{agent.model} · {agent.descricao || "Agente Anthropic"}</small></div><Button variant="secondary" onClick={() => void attachAgent(agent.id)}>Adicionar</Button></div>) : <div className="empty-state">Não existem outros agentes configurados.</div>}{currentUser?.role === "admin" ? <button className="chat-configure-agent" onClick={() => { setAgentsOpen(false); setConfigureAgentOpen(true); }}><Settings2 size={16} /><span><strong>Configurar um agente Claude + MCP</strong><small>A chave e os tokens ficam cifrados no servidor.</small></span><ChevronRight size={15} /></button> : null}</div></Modal>

      <Modal open={configureAgentOpen} onClose={() => setConfigureAgentOpen(false)} title="Configurar agente" description="O modelo conversa no canal; os MCP dão-lhe ferramentas e dados." width="720px"><form className="form-stack" onSubmit={configureAgent}><div className="form-grid"><label>Nome<input name="nome" required placeholder="Claude Vendas" maxLength={50} /></label><label>Modelo Anthropic<input name="model" required defaultValue="claude-sonnet-5" maxLength={100} /></label></div><label>Descrição<input name="descricao" placeholder="Ajuda a resumir contas e preparar follow-ups" maxLength={300} /></label><label>Instruções do agente<textarea name="instrucoes" rows={4} placeholder="Função, tom, limites e tarefas em que deve ajudar." maxLength={8000} /></label><label>Chave Anthropic<input name="apiKey" required type="password" autoComplete="new-password" placeholder="sk-ant-…" /><small className="field-help">É enviada uma vez e guardada cifrada. Nunca fica no browser nem é devolvida pela API.</small></label><div className="chat-mcp-editor"><header><div><strong>Servidores MCP remotos</strong><small>Opcional. Apenas URLs HTTPS públicas e de confiança.</small></div><Button type="button" variant="secondary" onClick={() => setMcpDrafts((current) => [...current, EMPTY_MCP()])}><Plus size={14} />MCP</Button></header>{mcpDrafts.map((server, index) => <div className="chat-mcp-row" key={server.id}><input aria-label={`Nome MCP ${index + 1}`} value={server.nome} onChange={(event) => setMcpDrafts((current) => current.map((item) => item.id === server.id ? { ...item, nome: event.target.value } : item))} placeholder="Nome do MCP" /><input aria-label={`URL MCP ${index + 1}`} value={server.url} onChange={(event) => setMcpDrafts((current) => current.map((item) => item.id === server.id ? { ...item, url: event.target.value } : item))} placeholder="https://mcp.exemplo.com/sse" /><input aria-label={`Token MCP ${index + 1}`} type="password" value={server.authorizationToken} onChange={(event) => setMcpDrafts((current) => current.map((item) => item.id === server.id ? { ...item, authorizationToken: event.target.value } : item))} placeholder="Token opcional" /><button type="button" className="icon-button" onClick={() => setMcpDrafts((current) => current.length === 1 ? [EMPTY_MCP()] : current.filter((item) => item.id !== server.id))} aria-label="Remover MCP"><X size={15} /></button></div>)}</div>{error ? <div className="auth-error">{error}</div> : null}<div className="modal__actions"><Button type="button" variant="secondary" onClick={() => setConfigureAgentOpen(false)}>Cancelar</Button><Button type="submit"><Bot size={15} />Guardar e adicionar</Button></div></form></Modal>

      {dataMode !== "supabase" ? <div className="chat-offline-banner">O chat partilhado precisa da ligação ao servidor.</div> : null}
    </div>
  );
}
