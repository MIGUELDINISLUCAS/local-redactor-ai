import { useState } from 'react';

const VIDEO_ID = 'PiNtIJDB2Cw';

// Click-to-play facade. The poster is served from our own origin and the
// YouTube iframe is only created once the visitor presses play — so simply
// landing on this page sends nothing to Google. On a page selling local-only
// privacy, an embed that phones home on load would undercut the pitch.
export default function VideoSection() {
  const [playing, setPlaying] = useState(false);

  return (
    <section id="demo" className="section-block video-section">
      <div className="video-intro">
        <div className="eyebrow dark"><span className="eyebrow-dot" /> See it in action</div>
        <h2>Watch it work,<br /><em>start to finish.</em></h2>
        <p>
          A short walkthrough: write a prompt full of sensitive details, review exactly what
          gets detected, send only the anonymised version — then read the reply with the real
          values restored on your device.
        </p>
      </div>

      <div className="video-frame">
        {playing ? (
          <iframe
            className="video-embed"
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`}
            title="Local Redactor for Claude and ChatGPT — demo"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            className="video-poster"
            onClick={() => setPlaying(true)}
            aria-label="Play the demo video"
          >
            <img src="/demo-poster.jpg" alt="" width={1280} height={720} loading="lazy" decoding="async" />
            <span className="video-scrim" />
            <span className="video-play">
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
              </svg>
            </span>
          </button>
        )}
      </div>

      <p className="video-note">
        <span className="video-note-dot" />
        Nothing is requested from YouTube until you press play.
      </p>
    </section>
  );
}
