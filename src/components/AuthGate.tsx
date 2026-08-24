import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowRight, CheckCircle2, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { consumeAppDeepLink, requestMagicLink, supabase } from "../lib/supabase";
import { Wordmark } from "./Logo";
import { Button } from "./ui";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [profileState, setProfileState] = useState<"loading" | "active" | "pending">(supabase ? "loading" : "active");

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

  if (!supabase) return children;
  if (session === undefined) return <div className="route-loading"><span /><p>A validar sessão segura…</p></div>;
  if (session && profileState === "loading") return <div className="route-loading"><span /><p>A confirmar aprovação da conta…</p></div>;
  if (session && profileState === "active") return children;
  if (session && profileState === "pending") return <div className="auth-screen"><aside><Wordmark /><div><p className="eyebrow">Acesso controlado</p><h1>Conta criada.<br />Falta aprovação.</h1><p>Um administrador Nikufra tem de ativar a tua conta antes de conseguires ler dados comerciais.</p></div><footer><span><ShieldCheck size={14} />RLS bloqueia todos os dados</span></footer></aside><main><section><div className="auth-mark"><ShieldCheck size={20} /></div><p className="eyebrow">Estado da conta</p><h2>A aguardar aprovação</h2><p>O pedido foi registado para {session.user.email}. Pede a um administrador que ative a conta em Definições → Utilizadores.</p><Button variant="secondary" onClick={() => void supabase!.auth.signOut()}>Sair desta conta</Button></section></main></div>;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStatus("loading"); setMessage("");
    try { await requestMagicLink(email); setStatus("sent"); }
    catch (error) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Não foi possível criar o magic link. Confirma o endereço e tenta novamente."); }
  }

  return (
    <div className="auth-screen">
      <aside><Wordmark /><div><p className="eyebrow">Inteligência comercial</p><h1>O contexto certo,<br />antes de cada conversa.</h1><p>Pipeline, relações e receita numa única superfície operacional.</p></div><footer><span><ShieldCheck size={14} />Servidor privado Nikufra</span><span>·</span><span>TLS 1.3</span><span>·</span><span>RLS ativo</span></footer></aside>
      <main><section><div className="auth-mark"><KeyRound size={20} /></div><p className="eyebrow">Acesso restrito</p><h2>Entrar no CRM</h2><p>Recebe um link de acesso seguro no teu email Nikufra. Não precisas de palavra-passe.</p>{status === "sent" ? <div className="auth-success"><CheckCircle2 size={22} /><strong>Verifica o teu email</strong><span>Enviámos um magic link para {email}. Expira em 10 minutos.</span><Button variant="secondary" onClick={() => setStatus("idle")}>Usar outro endereço</Button></div> : <form onSubmit={handleSubmit}><label>Email Nikufra<input type="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@nikufra.ai" /></label>{status === "error" ? <div className="auth-error">{message}</div> : null}<Button type="submit" disabled={status === "loading"}>{status === "loading" ? <Loader2 className="spin" size={16} /> : null}Continuar com magic link<ArrowRight size={16} /></Button></form>}<small>Ao continuar, o acesso fica registado no audit log.</small></section></main>
    </div>
  );
}
