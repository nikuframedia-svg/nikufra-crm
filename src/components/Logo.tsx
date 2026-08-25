import officialLogo from "../assets/nikufra-logo-official.png";
import officialMark from "../assets/nikufra-mark.png";

export function LogoMark() {
  return <img className="wordmark__mark" src={officialMark} alt="" aria-hidden="true" />;
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`wordmark ${compact ? "wordmark--compact" : ""}`} role="img" aria-label="Nikufra.ai">
      {compact ? <LogoMark /> : <span className="wordmark__lockup" aria-hidden="true"><img className="wordmark__logo wordmark__logo--base" src={officialLogo} alt="" /><img className="wordmark__logo wordmark__logo--color" src={officialLogo} alt="" /></span>}
    </div>
  );
}
