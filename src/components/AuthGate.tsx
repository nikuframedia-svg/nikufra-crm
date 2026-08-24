import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowRight, CheckCircle2, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { requestMagicLink, supabase } from "../lib/supabase";
import { Wordmark } from "./Logo";
import { Button } from "./ui";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabase) return children;
  if (session === undefined) return <div className="route-loading"><span /><p>A validar sessão segura…</p></div>;
  if (session) return children;

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
