import { useEffect, useState } from "react";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { Bot, Check, Loader2, ShieldCheck, X } from "lucide-react";
import { Wordmark } from "../components/Logo";
import { Button } from "../components/ui";
import { supabase } from "../lib/supabase";

const scopeLabels: Record<string, string> = {
  email: "Confirmar a identidade e o email da tua conta Nikufra",
  profile: "Ler o perfil básico associado à tua conta",
  openid: "Manter uma sessão segura em teu nome",
};

export function OAuthConsentPage() {
  const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase || !authorizationId) { setError("Pedido de autorização inválido."); return; }
    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: loadError }) => {
      if (loadError || !data) { setError(loadError?.message ?? "Não foi possível validar este pedido."); return; }
      if ("redirect_url" in data) { window.location.assign(data.redirect_url); return; }
      setDetails(data);
    });
  }, [authorizationId]);

  async function decide(action: "approve" | "deny") {
    if (!supabase || !authorizationId || busy) return;
    setBusy(action); setError("");
    const result = action === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data?.redirect_url) {
      setError(result.error?.message ?? "Não foi possível concluir a autorização.");
      setBusy("");
      return;
    }
    window.location.assign(result.data.redirect_url);
  }

  const scopes = details?.scope.split(/\s+/).filter(Boolean) ?? [];
  const redirectHost = details?.redirect_uri ? new URL(details.redirect_uri).hostname : "Claude";

  return <div className="auth-screen oauth-consent-screen">
    <aside><Wordmark /><div><p className="eyebrow">Conector MCP</p><h1>O CRM no Claude,<br />com o teu acesso.</h1><p>O Claude recebe apenas as permissões que confirmares e todas as consultas continuam sujeitas às regras de segurança da tua conta.</p></div><footer><span><ShieldCheck size={14} />OAuth 2.1 + PKCE</span><span>·</span><span>Acesso individual</span><span>·</span><span>Só leitura</span></footer></aside>
    <main><section>
      <div className="auth-mark"><Bot size={20} /></div>
      <p className="eyebrow">Pedido de ligação</p>
      <h2>Ligar {details?.client.name || "Claude"} ao CRM?</h2>
      {!details && !error ? <div className="oauth-consent-loading"><Loader2 className="spin" size={17} />A validar o pedido…</div> : null}
      {details ? <>
        <p><strong>{details.client.name}</strong> quer aceder ao Nikufra CRM em nome de <b>{details.user.email}</b>.</p>
        <div className="oauth-permission-list">
          <div><Check size={15} /><span><strong>Consultar dados comerciais</strong><small>Empresas, contactos, pipeline, atividades, faturação e sugestões de follow-up.</small></span></div>
          <div><ShieldCheck size={15} /><span><strong>Respeitar as permissões existentes</strong><small>O conector não ultrapassa o acesso da tua conta e começa em modo exclusivamente de leitura.</small></span></div>
          {scopes.map((scope) => <div key={scope}><Check size={15} /><span><strong>{scope}</strong><small>{scopeLabels[scope] ?? "Permissão técnica pedida pelo cliente MCP."}</small></span></div>)}
        </div>
        <div className="oauth-client-target"><span>Regresso seguro para</span><strong>{redirectHost}</strong></div>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        <div className="oauth-consent-actions"><Button variant="secondary" disabled={Boolean(busy)} onClick={() => void decide("deny")}>{busy === "deny" ? <Loader2 className="spin" size={15} /> : <X size={15} />}Recusar</Button><Button disabled={Boolean(busy)} onClick={() => void decide("approve")}>{busy === "approve" ? <Loader2 className="spin" size={15} /> : <Check size={15} />}Autorizar ligação</Button></div>
        <small>Podes revogar a ligação mais tarde nas definições de conectores do Claude.</small>
      </> : null}
      {error && !details ? <div className="auth-error" role="alert">{error}</div> : null}
    </section></main>
  </div>;
}
