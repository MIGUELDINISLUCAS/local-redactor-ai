const DOWNLOAD_PATH = '/downloads/Local-Redactor-AI-trial.zip';
const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/local-redactor-ai-%E2%80%94-priva/dppllhhednkmbcchgldbbnaedfaidgpj';

export default function SetupGuide() {
  return (
    <div className="setup-guide">
      <div className="setup-container">
        <div className="setup-header">
          <span className="setup-check">✓</span>
          <h1>Thank you for your purchase!</h1>
          <p>Follow these steps to get Local Redactor AI running. It takes about 5 minutes.</p>
        </div>

        <a className="setup-download" href={DOWNLOAD_PATH} download>
          <span className="setup-download-icon">↓</span>
          <span>
            <strong>Download Local Redactor AI</strong>
            <small>ZIP file — extract anywhere on your computer</small>
          </span>
        </a>

        <ol className="setup-steps">
          <li>
            <div className="step-header">
              <span className="step-num">1</span>
              <h2>Install Node.js</h2>
            </div>
            <p>Download and install from <a href="https://nodejs.org" target="_blank" rel="noopener">nodejs.org</a> (free, choose LTS). If you already have it, skip this.</p>
          </li>

          <li>
            <div className="step-header">
              <span className="step-num">2</span>
              <h2>Unzip and run setup</h2>
            </div>
            <p>Unzip the download and put the folder somewhere permanent (your home folder is fine).</p>
            <div className="step-detail">
              <strong>Mac:</strong> double-click <code>backend/setup.command</code>
              <br /><small>First time: right-click → Open → Open (to get past the security prompt)</small>
            </div>
            <div className="step-detail">
              <strong>Windows:</strong> double-click <code>backend/setup.bat</code>
            </div>
            <p>A terminal window will open. It downloads the detection model (~1.8 GB, one time) and installs everything. When it says <em>"All set"</em> you can close the window — the engine runs in the background from now on.</p>
          </li>

          <li>
            <div className="step-header">
              <span className="step-num">3</span>
              <h2>Add the browser extension</h2>
            </div>
            <p>Install from the Chrome Web Store (works on Chrome and Edge):</p>
            <div style={{marginTop: '8px'}}>
              <a href={CHROME_STORE_URL} target="_blank" rel="noopener" style={{color: '#6d3eea', fontWeight: 700, fontSize: '13px', textDecoration: 'none'}}>
                Add Local Redactor AI to your browser →
              </a>
            </div>
          </li>

          <li>
            <div className="step-header">
              <span className="step-num">4</span>
              <h2>Enter your license key</h2>
            </div>
            <p>You'll receive your license key by email. To activate it:</p>
            <ol className="sub-steps">
              <li>Click the Local Redactor icon in Chrome's toolbar</li>
              <li>Find the <strong>License</strong> section</li>
              <li>Paste your key and click <strong>Activate</strong></li>
            </ol>
          </li>

          <li>
            <div className="step-header">
              <span className="step-num">5</span>
              <h2>Start using it</h2>
            </div>
            <p>Go to <strong>chatgpt.com</strong> or <strong>claude.ai</strong>, turn on the <strong>🛡️ Protect</strong> toggle (bottom-right), and type normally. Your message is held for review and anonymised before it's sent.</p>
          </li>
        </ol>

        <div className="setup-help">
          <strong>Need help?</strong> Check the README.md inside the download, or reply to your purchase confirmation email.
        </div>
      </div>

      <style>{`
        .setup-guide {
          min-height: 100vh;
          background: #f5f5fa;
          padding: 40px 20px;
          font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #171525;
          -webkit-font-smoothing: antialiased;
        }
        .setup-container {
          max-width: 640px;
          margin: 0 auto;
        }
        .setup-header {
          text-align: center;
          margin-bottom: 32px;
        }
        .setup-check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: #e7f8f1;
          color: #12a875;
          font-size: 24px;
          font-weight: 700;
          margin-bottom: 16px;
        }
        .setup-header h1 {
          font-size: 24px;
          font-weight: 700;
          margin: 0 0 8px;
          letter-spacing: -0.02em;
        }
        .setup-header p {
          color: #56536a;
          font-size: 14px;
          margin: 0;
        }
        .setup-download {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 20px;
          background: #6d3eea;
          color: #fff;
          border-radius: 14px;
          text-decoration: none;
          margin-bottom: 28px;
          transition: background 0.15s;
        }
        .setup-download:hover { background: #5226c8; }
        .setup-download-icon {
          font-size: 22px;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.18);
          border-radius: 10px;
          flex: none;
        }
        .setup-download strong { display: block; font-size: 14px; }
        .setup-download small { font-size: 12px; opacity: 0.8; }
        .setup-steps {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .setup-steps > li {
          background: #fff;
          border: 1px solid #e9e7f0;
          border-radius: 14px;
          padding: 18px 20px;
          margin-bottom: 12px;
        }
        .step-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }
        .step-num {
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eee9ff;
          color: #6d3eea;
          font-size: 12px;
          font-weight: 800;
          border-radius: 50%;
          flex: none;
        }
        .step-header h2 {
          font-size: 14px;
          font-weight: 700;
          margin: 0;
        }
        .setup-steps p {
          font-size: 13px;
          line-height: 1.55;
          color: #56536a;
          margin: 0 0 8px;
        }
        .setup-steps p:last-child { margin-bottom: 0; }
        .step-detail {
          font-size: 12px;
          line-height: 1.5;
          padding: 10px 12px;
          background: #faf9ff;
          border: 1px solid #e9e7f0;
          border-radius: 8px;
          margin-bottom: 8px;
        }
        .step-detail small { color: #918da3; }
        code {
          padding: 2px 5px;
          background: #f3f1f7;
          border-radius: 4px;
          font-size: 0.92em;
        }
        .sub-steps {
          padding-left: 20px;
          margin: 6px 0 0;
          font-size: 13px;
          color: #56536a;
          line-height: 1.7;
        }
        a { color: #6d3eea; }
        .setup-help {
          text-align: center;
          padding: 16px;
          color: #918da3;
          font-size: 12px;
          margin-top: 8px;
        }
        .setup-help strong { color: #56536a; }
      `}</style>
    </div>
  );
}
