import { Link } from 'react-router-dom';
import Sea from './Sea.jsx';
import Mascot from './Mascot.jsx';
import { MASCOT_VARIANT } from './mascot.js';
import { HERO } from './landingContent.js';
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

export default function Landing() {
  return (
    <div className="nl-app nll">
      <Sea />
      <Masthead />
      <main>
        <LandingHero />
        {/* Task 4 appends Problem / HowItWorks / LedgerRoadmap / footer here */}
      </main>
    </div>
  );
}
