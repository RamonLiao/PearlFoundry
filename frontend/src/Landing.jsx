import { Link } from 'react-router-dom';
import Sea from './Sea.jsx';
import Mascot from './Mascot.jsx';
import { MASCOT_VARIANT } from './mascot.js';
import { HERO, PROBLEMS, STEPS, LEDGER_ROWS, ROADMAP, FOOTER } from './landingContent.js';
import './Landing.css';

function Masthead() {
  return (
    <header className="nll-top">
      <Link to="/" className="nll-brand" aria-label="PearlFoundry home">
        <img src="/logo-mark.png" alt="" width="34" height="34" />
        <span>Pearl<em>Foundry</em></span>
      </Link>
      <nav className="nll-nav">
        <span className="nll-navlinks">
          <a href="#problem">Problem</a>
          <a href="#how-it-works">How it works</a>
          <a href="#roadmap">Roadmap</a>
        </span>
        <Link to="/app" className="nll-cta nll-cta--sm">Launch App ↗</Link>
      </nav>
    </header>
  );
}

function LandingHero() {
  return (
    <section className="nl-section nll-hero" style={{ '--i': 0 }}>
      <div className="nll-hero-copy">
        <span className="nl-eyebrow nll-eyebrow">◆ {HERO.eyebrow}</span>
        <h1 className="nll-h1">{HERO.headline}</h1>
        <p className="nll-sub">{HERO.sub}</p>
        <div className="nll-ctas">
          <Link to="/app" className="nll-cta">Launch App ↗</Link>
          <a href="#how-it-works" className="nll-cta nll-cta--ghost">How it works ↓</a>
        </div>
      </div>
      <div className="nll-hero-art">
        <span className="nll-orb" aria-hidden="true" />
        <span className="nll-hero-mascot">
          <Mascot variant={MASCOT_VARIANT.JOYFUL} treatment="full" glow size={180} />
        </span>
      </div>
    </section>
  );
}

function LandingProblem() {
  return (
    <section id="problem" className="nl-section nll-band" style={{ '--i': 1 }}>
      <h2 className="nll-h2">The problem · retail is locked out</h2>
      <div className="nll-cells">
        {PROBLEMS.map((p) => (
          <div className="nll-cell" key={p.num}>
            <span className="nll-num">{p.num}</span>
            <h3 className="nll-cell-h">{p.title}</h3>
            <p className="nll-cell-p">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function LandingHowItWorks() {
  return (
    <section id="how-it-works" className="nl-section nll-band" style={{ '--i': 2 }}>
      <h2 className="nll-h2">How it works · mint → settle → claim</h2>
      <ol className="nll-ladder">
        {STEPS.map((s, i) => (
          <li className="nll-rung" key={s.key} style={{ '--rung': i }}>
            <span className="nll-rung-key">{s.title}</span>
            <p className="nll-rung-p">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LandingLedgerRoadmap() {
  return (
    <section id="roadmap" className="nl-section nll-band nll-lr" style={{ '--i': 3 }}>
      <div className="nll-ledger">
        <div className="nll-lr-head">
          <h2 className="nll-h2">Nacre Ledger · public track record</h2>
          <span className="nll-chip">Illustrative</span>
        </div>
        <table className="nll-table">
          <caption className="sr-only">Sample data — connect wallet to see live notes</caption>
          <tbody>
            {LEDGER_ROWS.map((r) => (
              <tr key={r.rank} className={r.you ? 'nll-tr nll-tr--you' : 'nll-tr'}>
                <td>#{r.rank}</td>
                <td>{r.issuer}{r.you ? ' · YOU' : ''}</td>
                <td className="nll-num-cell">{r.pnl}</td>
                <td className="nll-num-cell">{r.win}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="nll-foot-note">Ranked by realised PnL — visible before you connect.</p>
      </div>
      <div className="nll-roadmap-rail">
        <h2 className="nll-h2">Roadmap</h2>
        <ul className="nll-roadmap">
          {ROADMAP.map((r) => (
            <li className="nll-road-item" key={r.title}>
              <span className="nll-tick" aria-hidden="true">✓</span>
              <span><b>{r.title}</b> — {r.body}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="nll-footer">
      <span>{FOOTER.brand}</span>
      <span className="nll-tag">{FOOTER.tag}</span>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="nl-app nll">
      <Sea />
      <Masthead />
      <main>
        <LandingHero />
        <LandingProblem />
        <LandingHowItWorks />
        <LandingLedgerRoadmap />
        <LandingFooter />
      </main>
      <Link to="/app" className="nll-sticky-cta">Launch App ↗</Link>
    </div>
  );
}
