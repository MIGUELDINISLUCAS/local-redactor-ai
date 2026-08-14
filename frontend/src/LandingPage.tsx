type IconName = 'arrow' | 'download' | 'lock' | 'scan' | 'eye' | 'restore' | 'spark' | 'check';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (name === 'arrow') return <svg {...common}><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
  if (name === 'download') return <svg {...common}><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>;
  if (name === 'lock') return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></svg>;
  if (name === 'scan') return <svg {...common}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 12h8M12 8v8" /></svg>;
  if (name === 'eye') return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
  if (name === 'restore') return <svg {...common}><path d="M4 7v5h5M4.7 12A7.5 7.5 0 1 0 7 6.4" /><path d="m12 9 3 3-3 3" /></svg>;
  if (name === 'spark') return <svg {...common}><path d="m12 3 1.3 5.7L19 10l-5.7 1.3L12 17l-1.3-5.7L5 10l5.7-1.3L12 3ZM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" /></svg>;
  return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
}

import InteractiveDemo from './InteractiveDemo';
import ComplianceSection from './ComplianceSection';
import VideoSection from './VideoSection';

const steps = [
  { number: '01', icon: 'scan' as IconName, title: 'Detect on-device', copy: 'Emails, names, addresses and more are found before anything leaves your screen.' },
  { number: '02', icon: 'eye' as IconName, title: 'Review every match', copy: 'You stay in control. Keep, remove or teach the detector what matters.' },
  { number: '03', icon: 'restore' as IconName, title: 'Restore locally', copy: 'The reply comes back with your original details restored on your device.' },
];
const SUBSCRIBE_URL = 'https://buy.stripe.com/8x25kwf5R06d4AE1uwdIA03';
const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/local-redactor-ai-%E2%80%94-priva/dppllhhednkmbcchgldbbnaedfaidgpj';
// Pinned to the current release. We used /releases/latest/download/ before, but
// the model-assets prerelease (which hosts the GLiNER weights for CI) makes the
// "latest" redirect unreliable, so pin the tag explicitly and bump per release.
const MAC_DMG = 'https://github.com/MIGUELDINISLUCAS/local-redactor-ai/releases/download/v0.1.3/Local-Redactor-AI-arm64.dmg';
const WIN_EXE = 'https://github.com/MIGUELDINISLUCAS/local-redactor-ai/releases/download/v0.1.3/Local-Redactor-AI-Setup.exe';

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="Local Redactor AI home">
          <span className="brand-symbol"><Icon name="lock" size={17} /></span>
          <span>Local Redactor <em>AI</em></span>
        </a>
        <nav className="landing-links" aria-label="Main navigation">
          <a href="#demo">Demo</a>
          <a href="#how-it-works">How it works</a>
          <a href="#download">Download</a>
          <a href="#compliance">Compliance</a>
          <a href="#privacy">Privacy</a>
          <a className="nav-cta" href="#download">Download <Icon name="arrow" size={15} /></a>
        </nav>
      </header>

      <main id="top">
        <section className="landing-hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> Private by design</div>
            <h1>Make your next prompt<br /><span>private.</span></h1>
            <p className="hero-lede">Local Redactor AI removes sensitive details from useful prompts before they travel. Review everything, send with confidence, and keep your sensitive information on your device.</p>
            <div className="hero-actions">
              <a className="primary-cta" href="#download">Download now <Icon name="arrow" size={17} /></a>
              <a className="text-cta" href="#how-it-works">See how it works <span>↓</span></a>
            </div>
            <div className="hero-note"><Icon name="lock" size={14} /> Your original text never leaves your device.</div>
          </div>

          <div className="hero-visual" aria-label="Anonymisation preview">
            <div className="glow glow-one" /><div className="glow glow-two" />
            <div className="preview-window">
              <div className="window-bar"><div className="window-dots"><i /><i /><i /></div><span>local-redactor / review</span><span className="window-status"><b /> ready</span></div>
              <div className="preview-body">
                <div className="preview-label"><span>YOUR TASK</span><small>stays local</small></div>
                <p className="message original">Write a concise follow-up email to <mark>Alex Morgan</mark> about the contract renewal. Mention the new start date is <mark>1 September</mark>.</p>
                <div className="preview-divider"><span><Icon name="spark" size={13} /> protected in 42ms</span><i /></div>
                <div className="preview-label"><span>SENT TO AI</span><small className="safe">2 details hidden</small></div>
                <p className="message anonymised">Write a concise follow-up email to <strong>[PERSON_001]</strong> about the contract renewal. Mention the new start date is <strong>[DATE_001]</strong>.</p>
                <div className="preview-divider response-divider"><span><Icon name="restore" size={13} /> response returned locally</span><i /></div>
                <div className="preview-label"><span>AI DRAFT</span><small className="safe">restored on this device</small></div>
                <p className="message restored">Hi <strong>Alex Morgan</strong> — the renewal starts on <strong>1 September</strong>.</p>
                <div className="preview-footer"><span className="review-pill"><Icon name="check" size={13} /> original details restored locally</span></div>
              </div>
            </div>
            <div className="float-card float-card-top"><span className="float-icon purple"><Icon name="lock" size={15} /></span><span><b>Local first</b><small>no cloud storage</small></span></div>
          </div>
        </section>

        <section className="trust-strip" aria-label="Product benefits">
          <div><strong>0</strong><span>original prompts stored in the cloud</span></div>
          <div><strong>100%</strong><span>reviewable before sending</span></div>
          <div><strong>Local</strong><span>responses restored on your device</span></div>
        </section>

        <VideoSection />

        <section id="how-it-works" className="section-block process-section">
          <div className="section-intro"><div className="eyebrow dark"><span className="eyebrow-dot" /> Built for your browser</div><h2>Private by default,<br /><em>right where you work.</em></h2><p>Local Redactor is a browser extension for Chrome and Edge that currently works with ChatGPT and Claude. It detects sensitive details locally, lets you review them, and restores the result on your device.</p><div className="browser-note"><span className="browser-note-dot" /> Chrome &amp; Edge <i /> ChatGPT <i /> Claude</div></div>
          <div className="steps">{steps.map((step) => <article className="step" key={step.number}><div className="step-top"><span className="step-number">{step.number}</span><span className="step-icon"><Icon name={step.icon} size={20} /></span></div><h3>{step.title}</h3><p>{step.copy}</p></article>)}</div>
          <div style={{ gridColumn: '1 / -1' }}><InteractiveDemo /></div>
        </section>

        <section className="section-block tech-section">
          <div className="tech-intro">
            <div className="eyebrow dark"><span className="eyebrow-dot" /> Under the hood</div>
            <h2>Three detection layers,<br /><em>all on your device.</em></h2>
            <p>No cloud API calls. No data leaves your machine. Each layer catches what the others miss.</p>
          </div>
          <div className="tech-layers">
            <article className="tech-card">
              <div className="tech-card-icon regex-icon">.*</div>
              <h3>Rule-based patterns</h3>
              <p>Regex catches structured data instantly — emails, phone numbers, IBANs, tax IDs, passport numbers, NI numbers. Zero false negatives on known formats.</p>
              <div className="tech-tag">Always on · instant</div>
            </article>
            <article className="tech-card">
              <div className="tech-card-icon gliner-icon"><Icon name="scan" size={20} /></div>
              <h3>GLiNER NER model</h3>
              <p>A 1.8 GB token-level model runs in-process via ONNX Runtime. Catches names, organisations, addresses, and dates of birth that regex can't see.</p>
              <div className="tech-tag">Built-in · ~40ms per message</div>
            </article>
            <article className="tech-card">
              <div className="tech-card-icon ollama-icon"><Icon name="spark" size={20} /></div>
              <h3>Thorough mode</h3>
              <p>Optional: install Ollama and a 4 GB model for maximum recall on highly sensitive text. Falls back to the fast engine if not installed.</p>
              <div className="tech-tag">Optional · self-installed</div>
            </article>
          </div>
          <div className="tech-built-with">
            <span className="tech-built-label">Built with</span>
            <span className="tech-chip">Node.js</span>
            <span className="tech-chip">GLiNER</span>
            <span className="tech-chip">ONNX Runtime</span>
            <span className="tech-chip">Ollama</span>
            <span className="tech-chip">Ed25519</span>
            <span className="tech-chip">Chrome Extension API</span>
          </div>
        </section>

        <ComplianceSection />

        <section id="download" className="section-block download-section">
          <div className="download-intro">
            <div className="eyebrow dark"><span className="eyebrow-dot" /> Get started</div>
            <h2>Three steps to<br /><em>complete privacy.</em></h2>
            <p>Install the local engine, add the browser extension, and activate your key.</p>
          </div>
          <div className="download-cards">
            <article className="download-card">
              <span className="download-step">1</span>
              <div className="download-card-icon"><Icon name="download" size={22} /></div>
              <h3>Local engine</h3>
              <p>Install once and it runs quietly in the background. Powers the extension and keeps your data private on your machine.</p>
              <div className="download-links">
                <a className="download-btn" href={MAC_DMG}>Mac (Apple Silicon) <small>.dmg · 1.8 GB</small></a>
                <a className="download-btn" href={WIN_EXE}>Windows <small>.exe · 1.7 GB</small></a>
              </div>
              <p className="download-note">Large because the AI detection model is included — so it runs entirely offline, with nothing to download later.</p>
              <p className="download-note">Windows: if SmartScreen says "Windows protected your PC", click More info → Run anyway.</p>
            </article>
            <article className="download-card">
              <span className="download-step">2</span>
              <div className="download-card-icon"><Icon name="scan" size={22} /></div>
              <h3>Browser extension</h3>
              <p>Works on Chrome and Edge. Reviews your prompts and restores responses — all on your device.</p>
              <a className="download-btn primary" href={CHROME_STORE_URL} target="_blank" rel="noopener">Add to Chrome / Edge</a>
            </article>
            <article className="download-card">
              <span className="download-step">3</span>
              <div className="download-card-icon"><Icon name="lock" size={22} /></div>
              <h3>Subscribe</h3>
              <p>Your key arrives the moment you subscribe. Paste it into the extension to activate — it’s tied to your computer, and you can move it whenever you change machines.</p>
              <a className="download-btn primary" href={SUBSCRIBE_URL} target="_blank" rel="noopener">Subscribe monthly</a>
              <p className="download-note">Already have a promo key? Skip this and paste it straight into the extension.</p>
            </article>
          </div>
        </section>

        <section id="privacy" className="privacy-panel">
          <div className="privacy-copy"><div className="eyebrow light"><span className="eyebrow-dot" /> Built for sensitive work</div><h2>Keep the details,<br /><em>share only what’s necessary.</em></h2><p>Local Redactor creates temporary placeholders for private details, sends only the anonymised prompt, then restores the answer locally. You can inspect the transformation before every send.</p><a className="panel-link" href={CHROME_STORE_URL} target="_blank" rel="noopener">Add to Chrome / Edge <Icon name="arrow" size={16} /></a></div>
          <div className="privacy-orbit"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="orbit-core"><Icon name="lock" size={27} /><span>local</span></div><span className="orbit-chip chip-one">original stays here</span><span className="orbit-chip chip-two">only placeholders out</span></div>
        </section>

      </main>
      <footer className="landing-footer"><span>© 2026 Local Redactor AI</span><span><a href="/privacy.html">Privacy Policy</a></span><span className="footer-lock"><Icon name="lock" size={13} /> local-first, always</span></footer>
    </div>
  );
}
