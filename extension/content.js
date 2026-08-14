// Isolated content script: the UI + the bridge between the page's fetch hook
// (inject.js, MAIN world) and the local Redactor backend (via the background
// worker). Holds the send for review when Protect is on, and restores
// placeholders in replies.

(() => {
  const PLACEHOLDER_RE = /\[[A-Z]+_\d{3}\]/g;
  const PLACEHOLDER_TEST_RE = /\[[A-Z]+_\d{3}\]/;
  const STORAGE_KEY = 'lra-protect';
  let protectOn = false;
  let mapping = {}; // placeholder -> originalValue (for restoration)
  let activeReview = null; // { id }

  // ---- messaging to background (resilient to reloads) ----
  function isAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }
  function bg(msg) {
    return new Promise((resolve) => {
      if (!isAlive()) return resolve({ ok: false, error: 'context-invalidated' });
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) resolve({ ok: false, error: /invalidated/i.test(err.message) ? 'context-invalidated' : err.message });
          else resolve(resp || { ok: false, error: 'no response' });
        });
      } catch (e) {
        resolve({ ok: false, error: String((e && e.message) || e) });
      }
    });
  }
  async function refreshMapping() {
    const res = await bg({ type: 'getMappings' });
    if (res && res.ok) {
      mapping = {};
      for (const m of res.mappings) mapping[m.placeholder] = m.originalValue;
    }
    pushProtected();
  }

  // ---- talk to the page hook (MAIN world) ----
  function toPage(obj) { window.postMessage(Object.assign({ __lra: 1 }, obj), '*'); }
  function pushProtectState() { toPage({ type: 'protect-state', on: protectOn }); }
  // Give the page hook the set of values we're protecting so it can block ANY
  // outgoing request (fetch / XHR / beacon) that still carries one. This is the
  // user's CURRENT choice: only entities that are ticked in the active review.
  // Unticking a row removes it here, so the firewall stops guarding it.
  function currentProtected() {
    if (activeReview && Array.isArray(activeReview.entities)) {
      return activeReview.entities.filter((e) => e.include && e.originalValue).map((e) => e.originalValue);
    }
    return [];
  }
  // original value -> placeholder, so the page hook can SCRUB a protected value
  // that survives into the send outside the reviewed text (e.g. an attachment
  // filename) rather than hard-blocking and leaving the user stuck.
  function currentProtectedMap() {
    const map = {};
    if (activeReview && Array.isArray(activeReview.entities)) {
      for (const e of activeReview.entities) {
        if (e.include && e.originalValue && e.placeholder) map[e.originalValue] = e.placeholder;
      }
    }
    return map;
  }
  function pushProtected() { toPage({ type: 'protected-values', list: currentProtected(), map: currentProtectedMap() }); }

  // ---- vetted composer ------------------------------------------------------
  // Past a certain length the provider stops sending the message inline and
  // uploads it as an opaque file, which the firewall cannot read and therefore
  // refuses — that is why long documents never sent. The one case where such an
  // upload is provably safe is when the composer still holds EXACTLY the text we
  // anonymised and inserted ourselves. We assert that positively rather than
  // checking for the absence of known values: text typed straight into the
  // composer was never detected, so "no known value present" would happily wave
  // through PII we had simply never seen.
  let anonymisedInsert = null; // exact text we put in the composer after review

  function composerText() {
    const c = findComposer();
    if (!c) return '';
    return (c.tagName === 'TEXTAREA' ? c.value : c.innerText) || '';
  }
  let vettedExpiry = null;
  function pushComposerVetted() {
    if (anonymisedInsert === null) { toPage({ type: 'composer-vetted', vetted: false }); return; }
    const cur = composerText().trim();
    if (cur === '') {
      // The composer empties the instant a send starts, and the provider's file
      // upload follows right after. Treating "empty" as an edit would revoke the
      // vetting a beat before the upload we mean to allow, so hold it briefly
      // and then drop it rather than leaving it asserted indefinitely.
      clearTimeout(vettedExpiry);
      vettedExpiry = setTimeout(() => {
        anonymisedInsert = null;
        toPage({ type: 'composer-vetted', vetted: false });
      }, 60000);
      return;
    }
    clearTimeout(vettedExpiry);
    toPage({ type: 'composer-vetted', vetted: cur === anonymisedInsert.trim() });
  }
  // Sent synchronously on every edit: a debounce would leave a window where the
  // page still believes edited text is vetted.
  document.addEventListener('input', () => {
    if (anonymisedInsert !== null) pushComposerVetted();
  }, true);

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__lra !== 1) return;
    if (d.type === 'inject-ready') {
      pushProtectState();
      pushProtected();
    } else if (d.type === 'review-request') {
      openReview('intercept', d.id, d.text);
    } else if (d.type === 'leak-blocked') {
      if (d.routine) return; // draft/keystroke stream held — expected, no banner
      setStatus(
        d.reason === 'attachment-autofile'
          ? '🛡️ That message was long enough that ChatGPT uploaded it as a file, which can’t be anonymised — nothing was sent. Send it in smaller parts, or load the document with the 📎 button to anonymise it locally.'
          : d.reason === 'attachment'
          ? '🛡️ Remove the attached file, then re-add it with the 📎 button — raw upload blocked, nothing sent.'
          : d.reason === 'structure'
            ? '⚠ Send blocked — could not read the message to anonymise it (tell the developer). Nothing sent.'
            : d.reason === 'firewall'
              ? '🛡️ Send blocked by firewall — a protected value was about to leave the device. Nothing sent. (See console for which request.)'
              : '⚠ Send blocked — a name was still in the message after anonymising. Nothing sent.',
        'warn'
      );
    }
  });

  function answer(id, approved, text, originals) {
    toPage({ type: 'review-response', id, approved, text: text || '', originals: originals || [] });
  }

  // Show which detection engine actually produced these results. 'fast-fallback'
  // is the honest case: the user chose Thorough but its optional model isn't
  // installed, so fast ran instead — say so rather than badging "Thorough".
  function setEngineBadge(engine) {
    const label = {
      thorough: '🔍 Thorough',
      fast: '⚡ Fast mode',
      'fast-fallback': '⚡ Fast (Thorough not installed)',
      none: '⚠ Regex only',
    }[engine] || '⚡ Fast mode';
    elFastBadge.textContent = label;
    elFastBadge.style.display = '';
  }

  // ---- restoration: placeholders -> originals in the page ----
  // Restoration is for text the provider sent BACK to us. It must never touch an
  // editable area: the composer legitimately holds placeholders once a document
  // has been anonymised into it, and rewriting those to the originals would put
  // the real values straight back into the message about to be sent.
  function isInEditable(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
    }
    return false;
  }
  function restore(root) {
    if (!Object.keys(mapping).length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.nodeValue && PLACEHOLDER_TEST_RE.test(n.nodeValue) && !isInEditable(n)) nodes.push(n);
    }
    for (const n of nodes) n.nodeValue = n.nodeValue.replace(PLACEHOLDER_RE, (ph) => mapping[ph] ?? ph);
  }
  let restoreTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => restore(document.body), 120);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // ---- review overlay ----
  const CAT_COLORS = {
    EMAIL: '#1d4ed8', PHONE: '#047857', URL: '#7c3aed', IP_ADDRESS: '#0891b2',
    IBAN: '#db2777', CREDIT_CARD: '#dc2626', DATE: '#ea580c', MONETARY: '#a16207',
    TAX_ID: '#9333ea', REGISTRATION: '#b45309', POSTAL_CODE: '#65a30d',
    PERSON: '#be123c', ORGANIZATION: '#0f766e', ADDRESS: '#65a30d', LOCATION: '#059669',
    PII: '#be123c', CUSTOM: '#475569',
  };
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Coloured mark for light backgrounds: a purple shield with a white padlock.
  const LRA_GLYPH_C =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" style="display:inline-block;vertical-align:-3px;margin-right:4px">' +
    '<path d="M12 2.4 L19.6 5.2 V11 C19.6 16.3 16.3 20.1 12 21.6 C7.7 20.1 4.4 16.3 4.4 11 V5.2 Z" fill="#7c3aed"/>' +
    '<path d="M9.7 11.4 V9.7 a2.3 2.3 0 0 1 4.6 0 V11.4" stroke="#fff" stroke-width="1.7" fill="none"/>' +
    '<rect x="8.5" y="11.4" width="7" height="6.2" rx="1.4" fill="#fff"/>' +
    '</svg>';

  const overlay = document.createElement('div');
  overlay.id = 'lra-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div id="lra-card">
      <div id="lra-head">
        <strong>${LRA_GLYPH_C}Review before sending</strong>
        <span id="lra-fast-badge" style="display:none">⚡ Fast mode</span>
        <span id="lra-note"></span>
      </div>
      <p id="lra-sub">Only the anonymised text below is sent. Highlight text in the original to anonymise it; untick a row to keep it.</p>
      <div id="lra-body">
        <div id="lra-compare">
          <div class="lra-col">
            <label class="lra-lbl">Original message (highlight to anonymise)</label>
            <div id="lra-orig" class="lra-box"></div>
          </div>
          <div class="lra-col">
            <label class="lra-lbl">Exactly what will be sent</label>
            <div id="lra-preview" class="lra-box preview"></div>
          </div>
        </div>
        <div id="lra-tools">
          <button id="lra-anon-sel" disabled>${LRA_GLYPH_C}Anonymise selection</button>
          <label id="lra-remember-wrap"><input type="checkbox" id="lra-remember"> remember as a rule</label>
          <span id="lra-tool-hint"></span>
        </div>
        <div id="lra-table-wrap">
          <table id="lra-table">
            <thead><tr><th>On</th><th>Original</th><th>Category</th><th>Placeholder</th></tr></thead>
            <tbody id="lra-tbody"></tbody>
          </table>
        </div>
      </div>
      <div id="lra-actions">
        <button id="lra-cancel">Cancel send</button>
        <button id="lra-skip-review" title="Send the original message as typed, without anonymising. Use only when it contains no personal or sensitive data.">Send without review</button>
        <button id="lra-send" disabled>Send anonymised →</button>
      </div>
    </div>`;
  document.documentElement.appendChild(overlay);
  const $ = (s) => overlay.querySelector(s);
  const elNote = $('#lra-note'), elOrig = $('#lra-orig'), elTbody = $('#lra-tbody'),
    elPreview = $('#lra-preview'), elSend = $('#lra-send'), elCancel = $('#lra-cancel'),
    elSkipReview = $('#lra-skip-review'), elFastBadge = $('#lra-fast-badge'),
    elAnonSel = $('#lra-anon-sel'), elRemember = $('#lra-remember'), elToolHint = $('#lra-tool-hint');

  // Proportional scroll-sync between the two comparison panes so the user can
  // read the original and the anonymised send line-by-line even when the texts
  // differ in length. Ratio-based (not absolute) so mismatched heights still
  // track. A guard flag stops the two scroll handlers echoing each other.
  let syncing = false;
  function syncScroll(from, to) {
    if (syncing) return;
    syncing = true;
    const range = from.scrollHeight - from.clientHeight;
    to.scrollTop = range > 0 ? (from.scrollTop / range) * (to.scrollHeight - to.clientHeight) : 0;
    requestAnimationFrame(() => { syncing = false; });
  }
  elOrig.addEventListener('scroll', () => syncScroll(elOrig, elPreview));
  elPreview.addEventListener('scroll', () => syncScroll(elPreview, elOrig));

  // Capture the highlighted text in the original box AS IT'S SELECTED, so that
  // later clicking the button or the "remember" checkbox (which clears the page
  // selection) doesn't lose it.
  let lastSelection = '';
  function captureSelection() {
    const s = window.getSelection();
    if (s && s.anchorNode && elOrig.contains(s.anchorNode)) {
      const t = s.toString().trim();
      if (t) lastSelection = t;
    }
  }
  elOrig.addEventListener('mouseup', captureSelection);
  elOrig.addEventListener('keyup', captureSelection);
  // Don't let the button steal focus/clear the selection on mousedown.
  elAnonSel.addEventListener('mousedown', (e) => e.preventDefault());

  function placeholderFor(value, entities) {
    const ex = entities.find((e) => e.originalValue === value);
    if (ex) return ex.placeholder;
    for (const [ph, orig] of Object.entries(mapping)) if (orig === value) return ph;
    let max = 0;
    const scan = (ph) => { const m = ph && ph.match(/^\[CUSTOM_(\d+)\]$/); if (m) max = Math.max(max, parseInt(m[1], 10)); };
    entities.forEach((e) => scan(e.placeholder));
    Object.keys(mapping).forEach(scan);
    return `[CUSTOM_${String(max + 1).padStart(3, '0')}]`;
  }

  // Mirrors the backend: longest values first, replace every occurrence of
  // included entities. Excluded entities stay in the clear (user's choice).
  function computeAnonymised(text, entities) {
    const active = entities.filter((e) => e.include && e.originalValue);
    active.sort((a, b) => b.originalValue.length - a.originalValue.length);
    let out = text;
    for (const e of active) {
      const esc = e.originalValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Whole-token replace for letter/digit-edged values so "ena" isn't spliced
      // out of "penalty"; punctuation-edged values use a plain match.
      const edged = /^[\p{L}\p{N}]/u.test(e.originalValue) && /[\p{L}\p{N}]$/u.test(e.originalValue);
      const src = edged ? `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])` : esc;
      out = out.replace(new RegExp(src, 'gu'), e.placeholder);
    }
    return out;
  }

  function renderTable() {
    const ents = activeReview ? activeReview.entities : [];
    elTbody.innerHTML = '';
    for (const e of ents) {
      const color = CAT_COLORS[e.category] || CAT_COLORS.CUSTOM;
      const tr = document.createElement('tr');
      if (!e.include) tr.className = 'off';
      tr.innerHTML =
        `<td><input type="checkbox" ${e.include ? 'checked' : ''}></td>` +
        `<td class="orig" title="${escapeHtml(e.originalValue)}">${escapeHtml(e.originalValue)}${e.source === 'manual' ? ' <span class="added">(added)</span>' : ''}</td>` +
        `<td><span class="cat" style="background:${color}22;color:${color}">${escapeHtml(e.category)}</span>` +
        (typeof e.score === 'number' ? ` <span class="score${e.score < 0.6 ? ' low' : ''}" title="Model confidence — low scores are often false positives you can untick">${Math.round(e.score * 100)}%</span>` : '') +
        `</td>` +
        `<td class="ph">${escapeHtml(e.placeholder)}</td>`;
      tr.querySelector('input').addEventListener('change', () => {
        e.include = !e.include;
        // Learn from the choice: unticking a DETECTED item teaches the tool it's
        // not sensitive (dropped + taught to the model next time); re-ticking
        // undoes that. Manually-added items don't affect the not-sensitive list.
        if (e.source !== 'manual' && e.originalValue) {
          if (!e.include) {
            bg({ type: 'addIgnore', value: e.originalValue });
            const v = e.originalValue.length > 22 ? e.originalValue.slice(0, 22) + '…' : e.originalValue;
            elToolHint.textContent = `“${v}” won’t be flagged again (manage in the popup)`;
          } else {
            bg({ type: 'removeIgnore', value: e.originalValue });
          }
        }
        renderTable();
        renderPreview();
      });
      elTbody.appendChild(tr);
    }
  }
  function renderPreview() {
    if (!activeReview) return;
    elPreview.textContent = computeAnonymised(activeReview.originalText, activeReview.entities);
    elNote.textContent = `${activeReview.entities.filter((e) => e.include).length} item(s) anonymised`;
    pushProtected(); // keep the firewall in sync with every tick/untick
  }

  async function anonymiseSelection() {
    const value = (lastSelection || window.getSelection().toString()).trim();
    if (!value) { elToolHint.textContent = 'Highlight text in the original box first'; return; }
    if (/^\[[A-Z]+_\d{3}\]$/.test(value)) { elToolHint.textContent = 'Already a placeholder'; return; }
    if (activeReview.entities.some((e) => e.originalValue === value)) { elToolHint.textContent = 'Already in the list'; return; }
    const ph = placeholderFor(value, activeReview.entities);
    activeReview.entities.push({ id: 'm' + Date.now(), originalValue: value, category: 'CUSTOM', placeholder: ph, include: true, source: 'manual' });
    mapping[ph] = value;
    pushProtected();
    await bg({ type: 'addMapping', mapping: { placeholder: ph, originalValue: value, category: 'CUSTOM' } });
    let ruleNote = '';
    if (elRemember.checked) {
      const r = await bg({ type: 'addRule', rule: { pattern: value, category: 'CUSTOM', isRegex: false } });
      ruleNote = r && r.ok ? ' (rule saved)' : '';
    }
    elToolHint.textContent = `✓ ${value.length > 24 ? value.slice(0, 24) + '…' : value} → ${ph}${ruleNote}`;
    lastSelection = '';
    try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
    renderTable();
    renderPreview();
  }
  elAnonSel.addEventListener('click', anonymiseSelection);

  function closeOverlay() { overlay.style.display = 'none'; activeReview = null; }

  // Put document text into the composer. `vetted` records that this exact text
  // came out of a review, which is what lets the firewall allow an opaque
  // auto-file upload of it later.
  async function insertDocument(text, vetted) {
    const composer = findComposer();
    if (!composer) { setStatus('Open a chat first, then load a document', 'warn'); return; }
    if (await insertIntoComposer(composer, text)) {
      anonymisedInsert = vetted ? text : null;
      pushComposerVetted();
      setStatus(
        vetted ? 'Document anonymised — check it, then press Send' : 'Document inserted unchanged — press Send',
        vetted ? 'ok' : 'warn'
      );
    } else {
      let copied = false;
      try { await navigator.clipboard.writeText(text); copied = true; } catch (e) { /* ignore */ }
      setStatus(copied ? "Couldn't auto-insert — paste (⌘V) it, then Send" : "Couldn't load into the message box", 'warn');
    }
  }

  function finishApprove() {
    if (!activeReview) return;
    const review = activeReview;
    const text = computeAnonymised(review.originalText, review.entities);
    // Pass the originals so the page hook can block the send if any survived.
    const originals = review.entities.filter((e) => e.include).map((e) => e.originalValue);
    pushProtected(); // final ticked set, before the held send resumes
    if (review.mode === 'document') {
      // No request is being held — the anonymised text goes into the composer.
      closeOverlay();
      void insertDocument(text, true);
      return;
    }
    answer(review.id, true, text, originals);
    closeOverlay();
    // Return to the steady-state label so a transient hint (e.g. the "Loaded
    // <file> — press Send" notice after attaching a document) doesn't linger on
    // the pill through every later message.
    setStatus('Reviewing before send', 'ok');
  }
  function finishCancel() {
    if (!activeReview) return;
    const isDoc = activeReview.mode === 'document';
    if (!isDoc) answer(activeReview.id, false); // a document review holds no request
    closeOverlay();
    setStatus(isDoc ? 'Document discarded — nothing was inserted' : 'Send cancelled — nothing was sent', 'warn');
  }
  // Explicit bypass: send the original text as typed. Clear the active firewall
  // values first so the deliberately unredacted request is not blocked.
  function finishSendOriginal() {
    if (!activeReview) return;
    const review = activeReview;
    if (review.mode === 'document') {
      // Explicit opt-out: insert the document unchanged. It is NOT vetted, so an
      // opaque auto-file upload of it still gets refused.
      closeOverlay();
      void insertDocument(review.originalText, false);
      return;
    }
    toPage({ type: 'protected-values', list: [], map: {} });
    answer(review.id, true, review.originalText, []);
    closeOverlay();
    setStatus('Sent without review', '');
  }
  elSend.addEventListener('click', finishApprove);
  elCancel.addEventListener('click', finishCancel);
  elSkipReview.addEventListener('click', finishSendOriginal);
  document.addEventListener('keydown', (e) => {
    if (overlay.style.display !== 'none' && e.key === 'Escape') finishCancel();
  });

  // Review flow. mode 'intercept' = a held chat message (rewrite the request on
  // approve). mode 'document' = anonymise a file, then INSERT the anonymised text
  // into the composer (so even if ChatGPT turns it into an attachment, only the
  // anonymised text is uploaded — the original is never put into the page).
  // Split into pieces on paragraph/line boundaries, each <= max chars; a single
  // oversized paragraph is hard-cut.
  function splitForReview(text, max, overlap = 250) {
    if (text.length <= max) return [text];
    const out = [];
    let cur = '';
    for (const para of text.split(/\n{2,}/)) {
      if (para.length > max) {
        if (cur) { out.push(cur); cur = ''; }
        for (let i = 0; i < para.length; i += max) out.push(para.slice(i, i + max));
      } else if ((cur + '\n\n' + para).length > max && cur) {
        out.push(cur); cur = para;
      } else {
        cur = cur ? cur + '\n\n' + para : para;
      }
    }
    if (cur) out.push(cur);
    // Preserve the tail of the preceding piece so a name/address crossing a hard
    // cut is complete in at least one detection call. Entities are merged by
    // original value below, so overlap does not create duplicate review rows.
    return out.map((part, i) => (i === 0 ? part : out[i - 1].slice(-overlap) + part));
  }

  // Anonymise a long document piece by piece, merging the detected entities.
  // Placeholders stay stable because the background worker carries the running
  // mapping across calls (priorMappings).
  async function anonymiseInChunks(text, token) {
    const chunks = splitForReview(text, 3400);
    const merged = new Map(); // originalValue -> entity
    let anyNer = false, allNer = true, engine;
    for (let i = 0; i < chunks.length; i++) {
      if (!activeReview || activeReview.token !== token) return { ok: false, superseded: true };
      elNote.innerHTML = `<span class="lra-spinner"></span> Anonymising long document… (${i + 1}/${chunks.length})`;
      const r = await bg({ type: 'anonymise', text: chunks[i] });
      if (!r || !r.ok) return r || { ok: false, error: 'unknown' };
      anyNer = anyNer || r.nerUsed === true;
      allNer = allNer && r.nerUsed !== false;
      // A 'fast-fallback' on any chunk means thorough wasn't really used, so it
      // dominates: never claim "Thorough" if even one piece fell back.
      if (r.nerEngine === 'fast-fallback' || !engine) engine = r.nerEngine;
      for (const e of r.entities || []) {
        if (e.originalValue && !merged.has(e.originalValue)) merged.set(e.originalValue, e);
      }
    }
    return { ok: true, entities: [...merged.values()], nerUsed: anyNer, nerPartial: !allNer, nerEngine: engine };
  }

  let reviewToken = 0;
  async function openReview(mode, id, text) {
    // Only one provider request can own the review UI. If a second send arrives,
    // cancel the older held request instead of orphaning its fetch indefinitely.
    if (activeReview && activeReview.mode === 'intercept' && activeReview.id !== id) {
      answer(activeReview.id, false);
    }
    const token = ++reviewToken;
    activeReview = { mode, id, token, originalText: text, entities: [] };
    elOrig.textContent = text;
    elTbody.innerHTML = '';
    elPreview.textContent = '';
    elToolHint.textContent = '';
    elRemember.checked = false;
    elSend.disabled = true;
    elAnonSel.disabled = true;
    elNote.innerHTML = '<span class="lra-spinner"></span> Anonymising with the local model…';
    overlay.style.display = 'flex';
    // Interim badge from the saved preference while the request runs. It's
    // REPLACED below with the engine the backend actually used — a "thorough"
    // request silently falls back to fast when the optional model isn't
    // installed, and the badge must not claim otherwise.
    let thoroughPref = false;
    try {
      const fp = await chrome.storage.local.get('lra-thorough');
      thoroughPref = !!(fp && fp['lra-thorough']);
    } catch (e) { /* ignore */ }
    setEngineBadge(thoroughPref ? 'thorough' : 'fast');

    // Long documents are anonymised in pieces so no single call runs long enough
    // for the browser to kill the background worker mid-request. Placeholders stay
    // consistent across pieces (the backend reuses the running mapping).
    const res = text.length > 6000
      ? await anonymiseInChunks(text, token)
      : await bg({ type: 'anonymise', text });
    if (!activeReview || activeReview.token !== token) return; // superseded/closed

    if (!res || !res.ok) {
      // Fail safe: never send the original. Give an accurate reason.
      const err = (res && res.error) || 'unknown';
      // 'trial-expired' only comes from an older engine that still had the
      // built-in trial; the remedy is identical, so both say the same thing.
      if (err === 'license-required' || err === 'trial-expired') {
        elNote.textContent = 'A license is needed — nothing was sent. Enter your key in the extension popup, or subscribe there.';
      } else if (err === 'context-invalidated') {
        elNote.textContent = 'Extension was updated — refresh this tab (⌘R), then resend';
      } else if (/failed to fetch|networkerror|backend|ECONNREFUSED/i.test(err)) {
        elNote.textContent = 'Protection engine is starting up — wait a moment and resend';
      } else {
        elNote.textContent = `Anonymise failed: ${err} — send blocked`;
      }
      elPreview.textContent = text;
      elSend.disabled = true;
      return;
    }

    // Show the engine that ACTUALLY ran (may differ from the preference).
    setEngineBadge(res.nerEngine);
    await refreshMapping();
    activeReview.entities = (res.entities || []).map((e) => ({ ...e }));
    renderTable();
    renderPreview(); // pushes the ticked values to the firewall
    elSend.disabled = false;
    elAnonSel.disabled = false;

    // Safety: if NAME detection didn't run (e.g. the local model was still
    // loading), only structured data (emails/phones/IDs) was checked. Warn
    // loudly so the user doesn't assume "0 names" means the message is clean.
    if (res.nerUsed === false) {
      elNote.textContent = '⚠ Name detection didn’t run (model loading) — only emails/phones/IDs were checked. Cancel and resend to catch names.';
      elNote.style.color = '#b45309';
    } else {
      elNote.style.color = '';
    }
  }

  // ---- floating Protect toggle ----
  const panel = document.createElement('div');
  panel.id = 'lra-panel';
  panel.innerHTML = `<button id="lra-toggle" title="When on, every message is held for review and anonymised before it is sent."></button><button id="lra-doc" title="Attach a PDF / Word / text file — its text is extracted locally and ADDED to whatever you've typed, so your prompt and the document are anonymised and sent together in one message.">📎</button><span id="lra-status"></span>`;
  document.documentElement.appendChild(panel);
  const btn = panel.querySelector('#lra-toggle');
  const docBtn = panel.querySelector('#lra-doc');
  const statusEl = panel.querySelector('#lra-status');

  // ---- load a document's text into the composer ----
  // The doc becomes a normal message: you then Send, and the held-review flow
  // anonymises it and sends only the anonymised text. No copy/paste.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,.docx,.txt,.md,.csv';
  fileInput.style.display = 'none';
  document.documentElement.appendChild(fileInput);

  function inferMime(name, type) {
    if (type) return type;
    const ext = (name.split('.').pop() || '').toLowerCase();
    return {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
    }[ext] || 'application/octet-stream';
  }

  function findComposer() {
    const selectors = [
      '#prompt-textarea', 'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][translate="no"]', 'textarea[data-id]', 'textarea',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  // Insert text into ChatGPT/Claude's editor. ProseMirror only commits text via
  // Insert text CLIPBOARD-FREE. We deliberately avoid dispatching a synthetic
  // paste event: ChatGPT/Claude respond to paste by calling navigator.clipboard
  // .read(), which pops the "See text and images copied to the clipboard"
  // permission prompt. execCommand('insertText') and beforeinput both let
  // ProseMirror commit the text as normal input without any clipboard access.
  async function insertIntoComposer(el, text) {
    el.focus();
    // Whitespace-tolerant success check: ProseMirror re-flows newlines/spaces,
    // so an exact substring match on the raw text gives false negatives even
    // when the insert worked. Compare on collapsed whitespace instead.
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const probe = norm(text).slice(0, 40);
    const current = () => (el.tagName === 'TEXTAREA' ? el.value : el.innerText) || '';
    const has = () => probe.length > 0 && norm(current()).includes(probe);
    const waitFor = async (ms = 1500, step = 60) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (has()) return true;
        await new Promise((r) => setTimeout(r, step));
      }
      return has();
    };

    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return await waitFor(400);
    }

    const sel = window.getSelection();
    const selectAll = () => { const r = document.createRange(); r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r); };

    // Primary: execCommand insertText — replaces the selection, no clipboard.
    try { selectAll(); document.execCommand('insertText', false, text); } catch (e) { /* ignore */ }
    if (await waitFor()) return true;

    // Fallback, still clipboard-free: synthetic beforeinput/input.
    try {
      selectAll();
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertReplacementText', data: text, bubbles: true, cancelable: true }));
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
    } catch (e) { /* ignore */ }
    return await waitFor();
  }

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    setStatus(`Reading ${f.name}…`);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(f);
      });
      const base64 = String(dataUrl).split(',')[1] || '';
      const res = await bg({ type: 'parseFile', name: f.name, mime: inferMime(f.name, f.type), base64 });
      if (!res || !res.ok) {
        setStatus(res && res.error === 'context-invalidated' ? 'Refresh tab (⌘R)' : `Couldn't read file: ${res ? res.error : 'error'}`, 'warn');
        return;
      }
      if (!res.text || !res.text.trim()) {
        setStatus('No extractable text in that file (scanned image?)', 'warn');
        return;
      }
      const composer = findComposer();
      if (!composer) { setStatus('Open a chat first, then load a document', 'warn'); return; }
      if (!protectOn) await setProtect(true); // ensure the send is held for review
      // Make sure the page-world firewall has actually received the Protect-on
      // state before any document text lands in the composer — otherwise a
      // keystroke/draft telemetry request could fire in the gap.
      toPage({ type: 'protect-state', on: true });
      await new Promise((r) => setTimeout(r, 80));

      // Combine: keep whatever the user already typed and APPEND the document
      // text, so the prompt + doc go together as one message and are anonymised
      // in a single review.
      const existing = ((composer.tagName === 'TEXTAREA' ? composer.value : composer.innerText) || '').trim();
      const combined = existing ? `${existing}\n\n${res.text}` : res.text;

      // Anonymise BEFORE the text lands in the composer, rather than waiting for
      // Send. A document is usually long enough that the provider converts the
      // message into an opaque file upload, which the firewall cannot read and so
      // refuses — meaning a send-time review never got the chance to rewrite it.
      // Reviewing up front means whatever leaves is already anonymised.
      setStatus(`Anonymising “${f.name}”…`);
      openReview('document', null, combined);
    } catch (e) {
      setStatus("Couldn't read that file", 'warn');
    }
  });
  if (docBtn) docBtn.addEventListener('click', () => fileInput.click());

  // Our mark as an inline glyph: a white shield with the padlock as negative
  // space, so the lock shows through in whatever colour the button is.
  const LRA_GLYPH =
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="display:block;flex:none">' +
    '<defs><mask id="lraLockMask"><rect width="24" height="24" fill="#fff"/>' +
    '<rect x="8.5" y="11.4" width="7" height="6.2" rx="1.4" fill="#000"/>' +
    '<path d="M9.7 11.4 V9.7 a2.3 2.3 0 0 1 4.6 0 V11.4" stroke="#000" stroke-width="1.7" fill="none"/>' +
    '</mask></defs>' +
    '<path d="M12 2.4 L19.6 5.2 V11 C19.6 16.3 16.3 20.1 12 21.6 C7.7 20.1 4.4 16.3 4.4 11 V5.2 Z" fill="#fff" mask="url(#lraLockMask)"/>' +
    '</svg>';
  function renderToggle() {
    btn.innerHTML = LRA_GLYPH + '<span>' + (protectOn ? 'On' : 'Off') + '</span>';
    btn.className = protectOn ? 'on' : 'off';
  }
  // The status pill truncates (narrow, single-line), so mirror the full text into
  // the title attribute — hovering reveals the complete message.
  function setStatus(t, kind) { statusEl.textContent = t || ''; statusEl.title = t || ''; statusEl.className = kind || ''; }

  async function setProtect(on) {
    protectOn = on;
    renderToggle();
    pushProtectState();
    try { await chrome.storage.local.set({ [STORAGE_KEY]: on }); } catch (e) { /* ignore */ }
    if (on) {
      const h = await bg({ type: 'health' });
      if (h && h.error === 'context-invalidated') setStatus('Extension updated — refresh tab (⌘R)', 'warn');
      else if (!h || !h.ok) setStatus('⚠ Protection engine not running — open the Local Redactor app to start it', 'warn');
      else setStatus('Reviewing before send', 'ok');
    } else {
      setStatus('', '');
    }
  }
  btn.addEventListener('click', () => setProtect(!protectOn));

  // Restore saved toggle + initial mapping.
  (async () => {
    try {
      const saved = await chrome.storage.local.get(STORAGE_KEY);
      protectOn = !!(saved && saved[STORAGE_KEY]);
    } catch (e) { /* ignore */ }
    renderToggle();
    pushProtectState();
    if (protectOn) setProtect(true);
    refreshMapping();
  })();
})();
