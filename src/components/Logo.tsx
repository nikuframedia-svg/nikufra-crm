import type { SVGProps } from "react";

export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="2" y="2" width="20" height="20" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 17V7l10 10V7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return <div className="wordmark"><LogoMark /><span>{compact ? "N" : "Nikufra"}</span>{compact ? null : <em>CRM</em>}</div>;
}
