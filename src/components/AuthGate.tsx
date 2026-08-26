import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowRight, CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck, Users } from "lucide-react";
import { confirmGoogleImport, previewGoogleImport, startGoogleOAuth, type GoogleImportPreview } from "../lib/google-oauth";
import { consumeAppDeepLink, requestMagicLink, supabase } from "../lib/supabase";
import { Wordmark } from "./Logo";
import { Button } from "./ui";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [profileState, setProfileState] = useState<"loading" | "active" | "pending">(supabase ? "loading" : "active");
  const [googleState, setGoogleState] = useState<"idle" | "loading" | "oauth" | "preview" | "importing" | "ready" | "error">("idle");
  const [googlePreview, setGooglePreview] = useState<GoogleImportPreview | null>(null);
  const [googleMessage, setGoogleMessage] = useState("");
  const oauthStartedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const handleUrls = async (urls: string[]) => {
      for (const url of urls) {
        try {
          const result = await consumeAppDeepLink(url);
          if (result === "gmail") window.dispatchEvent(new CustomEvent("nikufra:gmail-connected"));
        } catch (error) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Não foi possível validar o link recebido.");
        }
      }
    };
    void import("@tauri-apps/plugin-deep-link").then(async ({ getCurrent, onOpenUrl }) => {
      const current = await getCurrent();
      if (current) await handleUrls(current);
      const stop = await onOpenUrl((urls) => { void handleUrls(urls); });
      if (disposed) stop(); else unlisten = stop;
    }).catch((error: unknown) => {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "O gestor de links da aplicação não arrancou.");
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    setProfileState("loading");
    void supabase.from("profiles").select("ativo").eq("id", session.user.id).single().then(({ data }) => setProfileState(data?.ativo ? "active" : "pending"));
  }, [session]);

  const loadGoogleOnboarding = useCallback(async () => {
    if (!supabase || !session || profileState !== "active") return;
    setGoogleState("loading"); setGoogleMessage("");
    const { data, error } = await supabase.from("google_tokens").select("import_confirmed_at").eq("user_id", session.user.id).maybeSingle();
    if (error) { setGoogleState("error"); setGoogleMessage(error.message); return; }
    if (!data) {
      setGoogleState("oauth");
      if (oauthStartedFor.current !== session.user.id) {
        oauthStartedFor.current = session.user.id;
        try { await startGoogleOAuth(); }
        catch (oauthError) { setGoogleState("error"); setGoogleMessage(oauthError instanceof Error ? oauthError.message : "Não foi possível abrir a autorização Google."); }
      }
      return;
    }
    if (data.import_confirmed_at) { setGoogleState("ready"); return; }
    setGoogleState("preview");
    try { setGooglePreview(await previewGoogleImport()); }
    catch (previewError) { setGoogleState("error"); setGoogleMessage(previewError instanceof Error ? previewError.message : "Não foi possível analisar a conta Google."); }
  }, [profileState, session]);

  useEffect(() => { void loadGoogleOnboarding(); }, [loadGoogleOnboarding]);

  useEffect(() => {
    const connected = () => { oauthStartedFor.current = null; void loadGoogleOnboarding(); };
    window.addEventListener("nikufra:gmail-connected", connected);
    return () => window.removeEventListener("nikufra:gmail-connected", connected);
  }, [loadGoogleOnboarding]);

  async function handleGoogleRetry() {
    setGoogleState("oauth"); setGoogleMessage("");
    try { await startGoogleOAuth(); }
    catch (error) { setGoogleState("error"); setGoogleMessage(error instanceof Error ? error.message : "Não foi possível abrir a autorização Google."); }
  }

  async function handleGoogleConfirm() {
    setGoogleState("importing"); setGoogleMessage("");
    try { await confirmGoogleImport(); setGoogleState("ready"); }
    catch (error) { setGoogleState("error"); setGoogleMessage(error instanceof Error ? error.message : "A importação não arrancou."); }
  }

  if (!supabase) return children;
  if (session === undefined) return <div className="route-loading"><span /><p>A validar sessão segura…</p></div>;
  if (session && profileState === "loading") return <div className="route-loading"><span /><p>A confirmar aprovação da conta…</p></div>;
  if (session && profileState === "active" && googleState === "ready") return children;
  if (session && profileState === "active" && ["idle", "loading"].includes(googleState)) return <div className="route-loading"><span /><p>A preparar a ligação segura à conta Google…</p></div>;
  if (session && profileState === "active" && googleState === "importing") return <div className="route-loading"><span /><p>A iniciar a importação sem duplicados…</p></div>;
  if (session && profileState === "active" && googleState === "oauth") return <div className="auth-screen"><aside><Wordmark /><div><p className="eyebrow">Conta individual</p><h1>O teu contexto Google,<br />no CRM da equipa.</h1><p>Cada utilizador autoriza apenas a própria conta. Os dados comerciais resultantes ficam partilhados no CRM.</p></div><footer><span><ShieldCheck size={14} />OAuth 2.0</span><span>·</span><span>Tokens cifrados</span></footer></aside><main><section><div className="auth-mark"><Mail size={20} /></div><p className="eyebrow">Autorização Google</p><h2>Confirma a tua conta</h2><p>A janela Google foi aberta automaticamente. Aceita as permissões e regressas aqui para rever quantos contactos serão importados.</p><Button onClick={() => void handleGoogleRetry()}>Abrir novamente<ArrowRight size={16} /></Button><Button variant="ghost" onClick={() => void supabase!.auth.signOut()}>Sair</Button></section></main></div>;
  if (session && profileState === "active" && googleState === "preview" && googlePreview) return <div className="auth-screen"><aside><Wordmark /><div><p className="eyebrow">Pré-visualização</p><h1>Tu decides<br />antes de importar.</h1><p>A análise é só de leitura. Nenhum contacto, email ou reunião é criado no CRM antes desta confirmação.</p></div><footer><span><ShieldCheck size={14} />Sem importação automática</span></footer></aside><main><section className="google-import-review"><div className="auth-mark"><Users size={20} /></div><p className="eyebrow">Conta Google analisada</p><h2>Encontrei {googlePreview.contactsFound.toLocaleString("pt-PT")} contactos</h2><p>{googlePreview.contactsExisting.toLocaleString("pt-PT")} já existem no CRM. Há {googlePreview.contactsNew.toLocaleString("pt-PT")} contactos novos para importar, sem duplicados.</p><div className="google-import-stats"><span><small>Mensagens Gmail</small><strong className="mono">{googlePreview.messagesFound.toLocaleString("pt-PT")}</strong></span><span><small>Já existentes</small><strong className="mono">{googlePreview.contactsExisting.toLocaleString("pt-PT")}</strong></span><span><small>Novos</small><strong className="mono">{googlePreview.contactsNew.toLocaleString("pt-PT")}</strong></span></div><Button onClick={() => void handleGoogleConfirm()}>Importar {googlePreview.contactsNew.toLocaleString("pt-PT")} novos<ArrowRight size={16} /></Button><Button variant="ghost" onClick={() => void supabase!.auth.signOut()}>Agora não — sair</Button><small>Depois da confirmação, Gmail e Calendar são processados em lotes e atualizados a cada 15 minutos.</small></section></main></div>;
  if (session && profileState === "active" && googleState === "error") return <div className="auth-screen"><aside><Wordmark /><div><p className="eyebrow">Ligação Google</p><h1>Não foi possível<br />concluir a ligação.</h1><p>Os dados do CRM continuam protegidos e nenhuma importação nova foi iniciada.</p></div><footer><span><ShieldCheck size={14} />Falha segura</span></footer></aside><main><section><div className="auth-mark"><Mail size={20} /></div><p className="eyebrow">Ação necessária</p><h2>Tenta novamente</h2><div className="auth-error">{googleMessage}</div><Button onClick={() => void handleGoogleRetry()}>Ligar conta Google<ArrowRight size={16} /></Button><Button variant="ghost" onClick={() => void supabase!.auth.signOut()}>Sair</Button></section></main></div>;
  if (session && profileState === "pending") return <div className="auth-screen"><aside><Wordmark /><div><p className="eyebrow">Acesso controlado</p><h1>Conta criada.<br />Falta aprovação.</h1><p>Um administrador Nikufra tem de ativar a tua conta antes de conseguires ler dados comerciais.</p></div><footer><span><ShieldCheck size={14} />RLS bloqueia todos os dados</span></footer></aside><main><section><div className="auth-mark"><ShieldCheck size={20} /></div><p className="eyebrow">Estado da conta</p><h2>A aguardar aprovação</h2><p>O pedido foi registado para {session.user.email}. Pede a um administrador que ative a conta em Definições → Utilizadores.</p><Button variant="secondary" onClick={() => void supabase!.auth.signOut()}>Sair desta conta</Button></section></main></div>;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStatus("loading"); setMessage("");
    try { await requestMagicLink(email); setStatus("sent"); }
    catch (error) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Não foi possível criar o magic link. Confirma o endereço e tenta novamente."); }
  }

  return (
    <div className="auth-screen">
      <aside><Wordmark /><div><p className="eyebrow">Inteligência comercial</p><h1>O contexto certo,<br />antes de cada conversa.</h1><p>Pipeline, relações e receita numa única superfície operacional.</p></div><footer><span><ShieldCheck size={14} />Servidor privado Nikufra</span><span>·</span><span>TLS 1.3</span><span>·</span><span>RLS ativo</span></footer></aside>
      <main><section><div className="auth-mark"><KeyRound size={20} /></div><p className="eyebrow">Acesso por convite</p><h2>Entrar no CRM</h2><p>Recebe um link de acesso seguro no email que foi convidado. Depois, a app pede autorização para a mesma conta Google.</p>{status === "sent" ? <div className="auth-success"><CheckCircle2 size={22} /><strong>Verifica o teu email</strong><span>Enviámos um magic link para {email}. Expira em 30 minutos.</span><Button variant="secondary" onClick={() => setStatus("idle")}>Usar outro endereço</Button></div> : <form onSubmit={handleSubmit}><label>Email convidado<input type="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@gmail.com" /></label>{status === "error" ? <div className="auth-error">{message}</div> : null}<Button type="submit" disabled={status === "loading"}>{status === "loading" ? <Loader2 className="spin" size={16} /> : null}Continuar com magic link<ArrowRight size={16} /></Button></form>}<small>Contas sem convite de administrador são recusadas.</small></section></main>
    </div>
  );
}
