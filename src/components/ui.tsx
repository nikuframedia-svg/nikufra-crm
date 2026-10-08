import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { owners as fallbackOwners, stageLabels } from "../data/seed";
import { useCRM } from "../state/crm-context";
import type { Stage } from "../types";

export function Button({ className = "", variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props}>{children}</div>;
}

export function Avatar({ ownerId, size = "md" }: { ownerId: string; size?: "sm" | "md" | "lg" }) {
  const { team } = useCRM();
  const owner = team.find((item) => item.id === ownerId) ?? fallbackOwners.find((item) => item.id === ownerId) ?? team[0] ?? fallbackOwners[0];
  return <span className={`avatar avatar--${size}`} style={{ "--avatar": owner.cor } as React.CSSProperties} title={owner.nome}>{owner.iniciais}</span>;
}

export function StageChip({ stage }: { stage: Stage }) {
  return <span className={`stage-chip stage-chip--${stage}`}><span />{stageLabels[stage]}</span>;
}

export function Modal({ open, title, description, onClose, children, width = "760px" }: { open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode; width?: string }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" style={{ maxWidth: width }}>
        <div className="modal__header">
          <div><p className="eyebrow">Nikufra CRM</p><h2 id="modal-title">{title}</h2>{description ? <p>{description}</p> : null}</div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function MetricCard({ label, value, change, detail, icon }: { label: string; value: string; change?: string; detail?: string; icon?: ReactNode }) {
  const positive = !change?.startsWith("−");
  return (
    <Card className="metric-card">
      <div className="metric-card__top"><span>{label}</span>{icon ? <span className="metric-card__icon">{icon}</span> : null}</div>
      <div className="metric-card__value mono">{value}</div>
      <div className="metric-card__foot">{change ? <span className={positive ? "positive" : "negative"}>{change}</span> : null}{detail ? <span>{detail}</span> : null}</div>
    </Card>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SampleBadge({ n }: { n: number }) {
  const insufficient = n < 5;
  return <span className={insufficient ? "sample sample--low" : "sample"} title={insufficient ? "Amostra insuficiente — indicativo" : `Calculado com ${n} observações`}>n={n}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
