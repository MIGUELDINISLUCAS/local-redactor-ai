import { useRef, useState, useCallback } from 'react';

const FULL_TEXT = 'Draft a follow-up email to Sarah Chen about the lease renewal at 42 Elm Street. Mention the new start date is 15 March 2025.';

const ENTITIES = [
  { original: 'Sarah Chen', placeholder: '[PERSON_001]' },
  { original: '42 Elm Street', placeholder: '[ADDRESS_001]' },
  { original: '15 March 2025', placeholder: '[DATE_001]' },
];

function Mark({ children }: { children: string }) {
  return <span className="demo-mark">{children}</span>;
}
function Placeholder({ children }: { children: string }) {
  return <span className="demo-placeholder">{children}</span>;
}
function Restored({ children }: { children: string }) {
  return <span className="demo-restored">{children}</span>;
}

function ShieldIcon({ color = 'currentColor', size = 14 }: { color?: string; size?: number }) {
  return (
    <svg viewBox="0 0 128 128" width={size} height={size} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <g transform="translate(15 15) scale(0.766)">
        <path d="M64 10 L110 26 V62 C110 94 89 114 64 120 C39 114 18 94 18 62 V26 Z" fill={color} />
        <path d="M50 62 V54 a14 14 0 0 1 28 0 V62" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
        <rect x="44" y="60" width="40" height="34" rx="7" fill="#fff" />
        <circle cx="64" cy="74" r="5" fill={color} />
        <rect x="61.5" y="76" width="5" height="11" rx="2.5" fill={color} />
      </g>
    </svg>
  );
}

type Phase = 'idle' | 'typing' | 'review' | 'sending' | 'response';

export default function InteractiveDemo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [typed, setTyped] = useState('');
  const cancelled = useRef(false);

  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(() => resolve(), ms);
    });
  }

  const run = useCallback(async () => {
    if (phase !== 'idle') return;
    cancelled.current = false;

    setTyped('');
    setPhase('typing');

    for (let i = 0; i <= FULL_TEXT.length; i++) {
      if (cancelled.current) return;
      setTyped(FULL_TEXT.slice(0, i));
      await sleep(18);
    }
    await sleep(600);
    if (cancelled.current) return;

    setPhase('review');
    await sleep(3000);
    if (cancelled.current) return;

    setPhase('sending');
    await sleep(1800);
    if (cancelled.current) return;

    setPhase('response');
  }, [phase]);

  const reset = () => {
    cancelled.current = true;
    setPhase('idle');
    setTyped('');
  };

  const dotIndex = phase === 'idle' ? 0 : phase === 'typing' ? 0 : phase === 'review' ? 1 : phase === 'sending' ? 2 : 3;

  return (
    <div className="demo-wrapper">
      <div className="demo-scene">
        <div className="demo-bar">
          <span className="demo-dots"><i /><i /><i /></span>
          <span className="demo-url">chatgpt.com</span>
          <span className="demo-protect"><ShieldIcon color="#0EA572" size={11} /> Protect ON</span>
        </div>

        <div className="demo-body">
          {/* Phase: typing / idle */}
          {(phase === 'idle' || phase === 'typing') && (
            <div className="demo-compose">
              <div className="demo-input">
                {typed || <span className="demo-input-hint">Type a message…</span>}
                {phase === 'typing' && <span className="demo-cursor">▌</span>}
              </div>
              <button className="demo-send-btn" aria-label="Send">
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" width="16" height="16"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
              </button>
            </div>
          )}

          {/* Phase: review */}
          {(phase === 'review' || phase === 'sending') && (
            <div className="demo-review">
              <div className="demo-review-header">
                <span className="demo-review-title"><span className="demo-shield">◆</span> Review before sending</span>
                <span className={`demo-review-badge ${phase === 'sending' ? 'sent' : ''}`}>
                  {phase === 'sending' ? 'Anonymised' : '3 details found'}
                </span>
              </div>
              <div className="demo-review-msg">
                {phase === 'review' ? (
                  <>Draft a follow-up email to <Mark>Sarah Chen</Mark> about the lease renewal at <Mark>42 Elm Street</Mark>. Mention the new start date is <Mark>15 March 2025</Mark>.</>
                ) : (
                  <>Draft a follow-up email to <Placeholder>[PERSON_001]</Placeholder> about the lease renewal at <Placeholder>[ADDRESS_001]</Placeholder>. Mention the new start date is <Placeholder>[DATE_001]</Placeholder>.</>
                )}
              </div>
              <table className="demo-table">
                <thead><tr><th>Original</th><th>Replaced with</th><th></th></tr></thead>
                <tbody>
                  {ENTITIES.map((e) => (
                    <tr key={e.original}>
                      <td>{e.original}</td>
                      <td><Placeholder>{e.placeholder}</Placeholder></td>
                      <td><span className="demo-check"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" width="10" height="10"><path d="m5 12 4 4L19 6" /></svg></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="demo-review-actions">
                <span className="demo-btn-cancel">Cancel</span>
                <span className="demo-btn-send">Send anonymised →</span>
              </div>
            </div>
          )}

          {/* Phase: response */}
          {phase === 'response' && (
            <div className="demo-response">
              <div className="demo-response-label">AI response — restored on your device</div>
              <div className="demo-response-bubble">
                Subject: Lease Renewal Follow-Up<br /><br />
                Hi <Restored>Sarah Chen</Restored>,<br /><br />
                I wanted to follow up regarding the lease renewal for the property at <Restored>42 Elm Street</Restored>. The new lease term is set to begin on <Restored>15 March 2025</Restored>.<br /><br />
                Please let me know if you have any questions.<br /><br />
                Best regards
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Narration */}
      <div className="demo-narrations">
        <div className={`demo-narr ${dotIndex >= 0 ? 'visible' : ''}`}>
          <span className="demo-narr-num">1</span>
          <div><strong>You type normally</strong><br /><span>Write your prompt as you always do. The Protect toggle is on.</span></div>
        </div>
        <div className={`demo-narr ${dotIndex >= 1 ? 'visible' : ''}`}>
          <span className="demo-narr-num">2</span>
          <div><strong>Your message is held for review</strong><br /><span>Sensitive details are detected and replaced — all on your device.</span></div>
        </div>
        <div className={`demo-narr ${dotIndex >= 2 ? 'visible' : ''}`}>
          <span className="demo-narr-num">3</span>
          <div><strong>Only the safe version is sent</strong><br /><span>ChatGPT only ever sees the anonymised text.</span></div>
        </div>
        <div className={`demo-narr ${dotIndex >= 3 ? 'visible' : ''}`}>
          <span className="demo-narr-num">4</span>
          <div><strong>The reply is restored locally</strong><br /><span>Your real details are swapped back in — only you see them.</span></div>
        </div>
      </div>

      {/* Controls */}
      <div className="demo-controls">
        <button className="demo-play" onClick={phase === 'idle' ? run : reset}>
          {phase === 'idle' ? (
            <><svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="14" height="14"><path d="M6 4l15 8-15 8z" /></svg> Play demo</>
          ) : phase === 'response' ? (
            'Replay'
          ) : (
            'Playing…'
          )}
        </button>
      </div>
      <div className="demo-progress">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`demo-dot ${dotIndex === i ? 'active' : ''}`} />
        ))}
      </div>
    </div>
  );
}
