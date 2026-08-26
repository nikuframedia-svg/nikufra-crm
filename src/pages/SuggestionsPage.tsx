import { useMemo, useState } from "react";
import { ArrowUpRight, Clock3, MailPlus, MessageSquareText, Search, UserRoundCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { stageLabels } from "../data/seed";
import { rankFollowUps } from "../lib/follow-up";
import { useCRM } from "../state/crm-context";
import type { Stage } from "../types";
import { Avatar, Button, Card, EmptyState, PageHeader, StageChip } from "../components/ui";

const dateFormatter = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric" });

function interactionLabel(total: number) {
  return `${total} interaç${total === 1 ? "ão" : "ões"}`;
}

export function SuggestionsPage() {
  const { followUpSuggestions, currentUserId, team, setEmailSelection } = useCRM();
  const [query, setQuery] = useState("");
  const [minimumDays, setMinimumDays] = useState(0);
  const [stage, setStage] = useState<Stage | "all">("all");
  const ranked = useMemo(() => rankFollowUps(followUpSuggestions), [followUpSuggestions]);
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-PT");
  const visible = useMemo(() => ranked.filter((item) =>
    item.daysSinceLastInteraction >= minimumDays
    && (stage === "all" || item.estado === stage)
    && (!normalizedQuery || `${item.contactoNome} ${item.empresa} ${item.contactoEmail}`.toLocaleLowerCase("pt-PT").includes(normalizedQuery))
  ), [minimumDays, normalizedQuery, ranked, stage]);
  const currentUser = team.find((owner) => owner.id === currentUserId);
  const staleCount = ranked.filter((item) => item.daysSinceLastInteraction >= 30).length;
  const interactions = ranked.reduce((sum, item) => sum + item.totalInteracoes, 0);
  const replies = ranked.reduce((sum, item) => sum + item.emailsRecebidos, 0);
  const longestSilence = ranked[0]?.daysSinceLastInteraction ?? 0;
  const stages = [...new Set(ranked.map((item) => item.estado))];

  return (
    <div className="page page--suggestions">
      <PageHeader
        eyebrow="Próximas ações"
        title="Sugestões de follow-up"
        description={`Fila pessoal de ${currentUser?.nome ?? "utilizador"}, calculada a partir de todas as conversas sincronizadas. Mais tempo sem contacto vem primeiro; em empate, ganha quem tem mais interações.`}
      />

      <div className="follow-up-metrics" aria-label="Resumo das sugestões">
        <Card><span><UserRoundCheck size={15} />Pessoas a acompanhar</span><strong className="mono">{ranked.length}</strong><small>com histórico real</small></Card>
        <Card><span><Clock3 size={15} />Sem contacto há 30+ dias</span><strong className="mono">{staleCount}</strong><small>prioridade elevada</small></Card>
        <Card><span><MessageSquareText size={15} />Interações analisadas</span><strong className="mono">{interactions}</strong><small>{replies} emails recebidos</small></Card>
        <Card><span><Clock3 size={15} />Maior silêncio</span><strong className="mono">{longestSilence}d</strong><small>desde a última conversa</small></Card>
      </div>

      <Card className="follow-up-card">
        <div className="follow-up-toolbar">
          <div className="table-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar pessoa, empresa ou email…" /></div>
          <div className="follow-up-filters">
            <label>Inatividade<select value={minimumDays} onChange={(event) => setMinimumDays(Number(event.target.value))}><option value={0}>Qualquer período</option><option value={7}>7+ dias</option><option value={14}>14+ dias</option><option value={30}>30+ dias</option><option value={60}>60+ dias</option><option value={90}>90+ dias</option></select></label>
            <label>Estado<select value={stage} onChange={(event) => setStage(event.target.value as Stage | "all")}><option value="all">Todos os estados</option>{stages.map((item) => <option value={item} key={item}>{stageLabels[item]}</option>)}</select></label>
          </div>
        </div>

        <div className="follow-up-rule"><span>Prioridade</span><span>Pessoa e empresa</span><span>Último contacto</span><span>Histórico</span><span>Último contexto</span><span>Ação</span></div>
        <div className="follow-up-list">
          {visible.map((item, index) => (
            <article className="follow-up-row" key={`${item.userId}:${item.contactId}`}>
              <div className="follow-up-rank"><b className="mono">{String(index + 1).padStart(2, "0")}</b><span className={`age-badge age-badge--${item.daysSinceLastInteraction >= 60 ? "danger" : item.daysSinceLastInteraction >= 30 ? "warning" : "good"}`}>{item.daysSinceLastInteraction}d</span></div>
              <div className="follow-up-person"><span className="company-monogram">{item.contactoNome.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><div><strong>{item.contactoNome}</strong><Link to="/empresas/$companyId" params={{ companyId: item.empresaId }}>{item.empresa}<ArrowUpRight size={11} /></Link><small>{item.contactoCargo || item.contactoEmail}</small></div></div>
              <div className="follow-up-last"><strong>há {item.daysSinceLastInteraction} dia{item.daysSinceLastInteraction === 1 ? "" : "s"}</strong><time dateTime={item.ultimaInteracaoEm}>{dateFormatter.format(new Date(item.ultimaInteracaoEm))}</time><StageChip stage={item.estado} /></div>
              <div className="follow-up-history"><strong className="mono">{interactionLabel(item.totalInteracoes)}</strong><span>{item.totalMensagens} {item.totalMensagens === 1 ? "mensagem" : "mensagens"} · {item.reunioes} reuni{item.reunioes === 1 ? "ão" : "ões"}</span><small>{item.emailsEnviados} enviados · {item.emailsRecebidos} recebidos</small></div>
              <div className="follow-up-context"><strong>{item.ultimoAssunto}</strong><p>{item.ultimoResumo}</p></div>
              <div className="follow-up-action">{item.ownerId ? <Avatar ownerId={item.ownerId} size="sm" /> : null}<Link to="/email" onClick={() => setEmailSelection([item.contactId])}><Button><MailPlus size={15} />Preparar</Button></Link></div>
            </article>
          ))}
          {!visible.length ? <EmptyState>{ranked.length ? "Nenhuma sugestão corresponde aos filtros atuais." : "Ainda não existem conversas sincronizadas suficientes para sugerir follow-ups."}</EmptyState> : null}
        </div>
        <footer className="follow-up-footer"><span>{visible.length} de {ranked.length} sugestões</span><span>Critério: dias sem contacto ↓ · número de interações ↓</span></footer>
      </Card>
    </div>
  );
}
