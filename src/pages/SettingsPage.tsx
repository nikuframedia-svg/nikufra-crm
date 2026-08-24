import { useState } from "react";
import { Check, ChevronRight, Database, KeyRound, Mail, Save, ShieldCheck, SlidersHorizontal, UserCheck, Users } from "lucide-react";
import { stageLabels, stageOrder, stageProbability } from "../data/seed";
import { useCRM } from "../state/crm-context";
import { Avatar, Button, Card, PageHeader } from "../components/ui";

export function SettingsPage() {
  const { team } = useCRM();
  const [section, setSection] = useState("users");
  const [saved, setSaved] = useState(false);
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
          {section === "users" ? <><div className="settings-header"><div><p className="eyebrow">Acesso partilhado</p><h2>Utilizadores</h2><p>Qualquer conta nova fica inativa até aprovação de um administrador.</p></div><Button><UserCheck size={16} />Convidar por email</Button></div><div className="user-list">{team.map((owner, index) => <div key={owner.id}><Avatar ownerId={owner.id} size="md" /><span><strong>{owner.nome}{index === 0 ? <em>Tu</em> : null}</strong><small>{owner.email}</small></span><span className="user-status"><i />Ativo</span><select defaultValue={owner.role}><option value="admin">Administrador</option><option value="member">Membro</option></select><button className="icon-button"><ChevronRight size={15} /></button></div>)}</div><div className="pending-access"><span><KeyRound size={17} /></span><div><strong>Aprovação obrigatória</strong><p>Novos utilizadores @nikufra.ai podem pedir acesso, mas não leem dados antes de aprovação.</p></div><span className="mono">0 pendentes</span></div></> : null}
          {section === "goals" ? <><div className="settings-header"><div><p className="eyebrow">Modelo comercial</p><h2>Objetivos e probabilidades</h2><p>Valores usados pelo pipeline ponderado e pela cobertura.</p></div>{saved ? <span className="saved-label"><Check size={15} />Guardado</span> : <Button onClick={() => { setSaved(true); window.setTimeout(() => setSaved(false), 1800); }}><Save size={15} />Guardar alterações</Button>}</div><div className="goal-grid"><label>Objetivo anual de faturação<input className="mono" defaultValue="480.000,00 €" /></label><label>Objetivo mensal atual<input className="mono" defaultValue="40.000,00 €" /></label><label>Objetivo mensal de reuniões<input className="mono" defaultValue="10" /></label><label>Objetivo mensal de propostas<input className="mono" defaultValue="5" /></label></div><h3 className="settings-subtitle">Probabilidade por estado</h3><div className="probability-list">{stageOrder.map((stage, index) => <div key={stage}><span className="mono">0{index + 1}</span><strong>{stageLabels[stage]}</strong><input type="range" min="0" max="100" defaultValue={stageProbability[stage]} /><b className="mono">{stageProbability[stage]}%</b></div>)}</div></> : null}
          {section === "security" ? <><div className="settings-header"><div><p className="eyebrow">Defesa em profundidade</p><h2>Segurança</h2><p>Magic links, RLS, sessões e registo de acesso.</p></div><span className="security-grade"><ShieldCheck size={17} />Protegido</span></div><div className="security-list"><div><span><KeyRound size={18} /></span><div><strong>Autenticação sem palavra-passe</strong><p>Magic links limitados ao domínio @nikufra.ai. Sessões renovadas automaticamente.</p></div><b>Ativo</b></div><div><span><Database size={18} /></span><div><strong>Row Level Security</strong><p>Ativa em todas as tabelas. O cliente nunca recebe a service role key.</p></div><b>Ativo</b></div><div><span><ShieldCheck size={18} /></span><div><strong>Servidor self-hosted</strong><p>Postgres apenas na rede privada; gateway público via TLS 1.3.</p></div><b>Ativo</b></div></div></> : null}
          {section === "gmail" ? <><div className="settings-header"><div><p className="eyebrow">Google Workspace</p><h2>Integração Gmail</h2><p>Acesso mínimo para ler conversas e criar rascunhos.</p></div><span className="saved-label"><Check size={15} />Ligado</span></div><div className="integration-card"><div className="gmail-mark">M</div><div><strong>joao@nikufra.ai</strong><p>Sincronização incremental a cada 15 minutos.</p><span>gmail.readonly</span><span>gmail.compose</span></div><Button variant="secondary">Desligar</Button></div><div className="integration-note"><ShieldCheck size={18} /><span><strong>Sem permissão de envio.</strong> O CRM cria rascunhos; cada mensagem é revista e enviada manualmente no Gmail.</span></div></> : null}
          {section === "data" ? <><div className="settings-header"><div><p className="eyebrow">Privacidade</p><h2>Dados e RGPD</h2><p>Exporta ou elimina definitivamente os dados de um contacto.</p></div></div><div className="rgpd-search"><input placeholder="Pesquisar contacto por email..." /><Button>Pesquisar</Button></div><div className="integration-note"><Database size={18} /><span><strong>Backups diários verificados.</strong> 30 cópias diárias, 12 mensais e teste de restauro agendado.</span></div></> : null}
        </Card>
      </div>
    </div>
  );
}
