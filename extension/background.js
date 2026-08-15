// Background service worker: the only place that talks to the local Redactor
// backend. Holds the running placeholder mapping per browser tab so a whole
// conversation shares stable placeholders, and so restoration works.

const BACKEND = 'http://localhost:3001';

// tabId -> { mappings: [{placeholder, originalValue, category}], byPlaceholder: {} }
const tabState = new Map();
const tabStateLoads = new Map();
const TAB_STATE_PREFIX = 'lra-tab-state:';

function stateKey(tabId) { return `${TAB_STATE_PREFIX}${tabId}`; }

// MV3 service workers are suspended routinely, which clears module memory. Keep
// conversation mappings in session storage so restoration and placeholder
// numbering survive worker restarts without persisting beyond the browser session.
async function getState(tabId) {
  if (tabState.has(tabId)) return tabState.get(tabId);
  if (!tabStateLoads.has(tabId)) {
    tabStateLoads.set(tabId, (async () => {
      let state = { mappings: [] };
      try {
        const stored = await chrome.storage.session.get(stateKey(tabId));
        const candidate = stored[stateKey(tabId)];
        if (candidate && Array.isArray(candidate.mappings)) state = candidate;
      } catch (e) { /* session storage unavailable — use memory for this run */ }
      tabState.set(tabId, state);
      return state;
    })());
  }
  try {
    return await tabStateLoads.get(tabId);
  } finally {
    tabStateLoads.delete(tabId);
  }
}

async function saveState(tabId, state) {
  tabState.set(tabId, state);
  try { await chrome.storage.session.set({ [stateKey(tabId)]: state }); } catch (e) { /* memory fallback */ }
}

async function deleteState(tabId) {
  tabState.delete(tabId);
  tabStateLoads.delete(tabId);
  try { await chrome.storage.session.remove(stateKey(tabId)); } catch (e) { /* ignore */ }
}

function mergeMappings(prior, next) {
  const map = new Map(prior.map((m) => [m.placeholder, m]));
  for (const m of next) map.set(m.placeholder, m);
  return [...map.values()];
}

// The backend runs as an always-on background service that restarts itself, so a
// failed probe is usually a momentary blip (a restart, or waking from sleep) —
// not "offline". Retry briefly before reporting it down, so users don't see a
// scary banner for a gap that heals itself in a second.
async function health(attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BACKEND}/health`, { method: 'GET' });
      if (res.ok) return true;
    } catch (e) { /* not up yet */ }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return false;
}

async function getRules() {
  try {
    const r = await chrome.storage.local.get('lra-rules');
    return Array.isArray(r['lra-rules']) ? r['lra-rules'] : [];
  } catch (e) {
    return [];
  }
}

// Thorough check: opt into the accurate Ollama 4B (slower, higher recall)
// instead of the default fast GLiNER engine.
async function getThorough() {
  try {
    const r = await chrome.storage.local.get('lra-thorough');
    return !!r['lra-thorough'];
  } catch (e) {
    return false;
  }
}

// "Not sensitive" terms the user unticked — dropped from detection and taught to
// the model as negative examples so it stops flagging them.
async function getIgnore() {
  try {
    const r = await chrome.storage.local.get('lra-ignore');
    return Array.isArray(r['lra-ignore']) ? r['lra-ignore'] : [];
  } catch (e) {
    return [];
  }
}
async function addIgnore(value) {
  const v = String(value || '').trim();
  if (!v) return;
  const list = await getIgnore();
  if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) {
    list.push(v);
    await chrome.storage.local.set({ 'lra-ignore': list });
  }
}
async function removeIgnore(value) {
  const v = String(value || '').trim().toLowerCase();
  const list = (await getIgnore()).filter((x) => x.toLowerCase() !== v);
  await chrome.storage.local.set({ 'lra-ignore': list });
}

// Network-level failure only (server not listening yet, momentarily down for a
// restart, machine just woke from sleep) — never for an HTTP error response,
// which fetch() resolves rather than rejects.
async function fetchWithRetry(url, init, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}

// Anonymise text, accumulating placeholders for this tab's conversation.
async function anonymise(tabId, text) {
  const state = await getState(tabId);
  const customRules = await getRules();
  const thorough = await getThorough();
  const ignore = await getIgnore();
  // Retry connection-level failures (same rationale as health(): the backend
  // restarts itself and a momentary blip during that — or during the first-run
  // model download — shouldn't surface as a scary "not working" message).
  const res = await fetchWithRetry(`${BACKEND}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, priorMappings: state.mappings, customRules, thorough, ignore }),
  });
  if (!res.ok) {
    let info = null;
    try { info = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 403 && info && (info.error === 'trial-expired' || info.error === 'license-required')) {
      throw new Error(info.error);
    }
    throw new Error(`backend ${res.status}`);
  }
  const data = await res.json();
  state.mappings = mergeMappings(state.mappings, data.mappings || []);
  await saveState(tabId, state);
  const entities = data.entities || [];
  const changed = entities.filter((e) => e.include).length;
  return {
    anonymisedText: data.anonymisedText,
    entities,
    changed,
    mappingCount: state.mappings.length,
    nerUsed: data.nerUsed,
    nerPartial: data.nerPartial,
    nerEngine: data.nerEngine,
  };
}

// Keep the MV3 service worker alive during long operations (anonymising a big
// document can take minutes). Without this the worker is terminated and the
// message channel closes before we can respond ("message channel closed…").
let kaTimer = null;
let kaCount = 0;
function keepAlive(on) {
  if (on) {
    kaCount++;
    if (!kaTimer) kaTimer = setInterval(() => { try { chrome.runtime.getPlatformInfo(() => {}); } catch (e) { /* ignore */ } }, 20000);
  } else {
    kaCount = Math.max(0, kaCount - 1);
    if (kaCount === 0 && kaTimer) { clearInterval(kaTimer); kaTimer = null; }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  (async () => {
    const longOp = msg.type === 'anonymise' || msg.type === 'parseFile';
    if (longOp) keepAlive(true);
    try {
      if (msg.type === 'health') {
        sendResponse({ ok: await health() });
      } else if (msg.type === 'ner-status') {
        try {
          const res = await fetch(`${BACKEND}/api/ner-status`);
          const data = await res.json();
          sendResponse({ ok: true, ...data });
        } catch (e) {
          sendResponse({ ok: false });
        }
      } else if (msg.type === 'anonymise') {
        sendResponse({ ok: true, ...(await anonymise(tabId, msg.text)) });
      } else if (msg.type === 'addMapping') {
        const st = await getState(tabId);
        st.mappings = mergeMappings(st.mappings, [msg.mapping]);
        await saveState(tabId, st);
        sendResponse({ ok: true });
      } else if (msg.type === 'addRule') {
        const rules = await getRules();
        const exists = rules.some((r) => r.pattern === msg.rule.pattern && r.category === msg.rule.category);
        if (!exists) {
          rules.push(msg.rule);
          await chrome.storage.local.set({ 'lra-rules': rules });
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'parseFile') {
        // base64 (from content script) -> Blob -> backend /api/file (parse only).
        const bin = atob(msg.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const fd = new FormData();
        fd.append('file', new Blob([bytes], { type: msg.mime || 'application/octet-stream' }), msg.name);
        const res = await fetch(`${BACKEND}/api/file`, { method: 'POST', body: fd });
        if (!res.ok) { sendResponse({ ok: false, error: `backend ${res.status}` }); return; }
        const data = await res.json();
        sendResponse({ ok: true, text: data.extractedText || '', meta: data.fileMetadata || {} });
      } else if (msg.type === 'getRules') {
        sendResponse({ ok: true, rules: await getRules() });
      } else if (msg.type === 'removeRule') {
        const rules = await getRules();
        if (msg.index >= 0 && msg.index < rules.length) rules.splice(msg.index, 1);
        await chrome.storage.local.set({ 'lra-rules': rules });
        sendResponse({ ok: true, rules });
      } else if (msg.type === 'updateRule') {
        const rules = await getRules();
        if (msg.index >= 0 && msg.index < rules.length && msg.rule && msg.rule.pattern) {
          rules[msg.index] = {
            pattern: String(msg.rule.pattern),
            category: msg.rule.category || 'CUSTOM',
            isRegex: !!msg.rule.isRegex,
          };
          await chrome.storage.local.set({ 'lra-rules': rules });
        }
        sendResponse({ ok: true, rules });
      } else if (msg.type === 'clearRules') {
        await chrome.storage.local.set({ 'lra-rules': [] });
        sendResponse({ ok: true });
      } else if (msg.type === 'addIgnore') {
        await addIgnore(msg.value);
        sendResponse({ ok: true });
      } else if (msg.type === 'removeIgnore') {
        await removeIgnore(msg.value);
        sendResponse({ ok: true });
      } else if (msg.type === 'getIgnore') {
        sendResponse({ ok: true, ignore: await getIgnore() });
      } else if (msg.type === 'clearIgnore') {
        await chrome.storage.local.set({ 'lra-ignore': [] });
        sendResponse({ ok: true });
      } else if (msg.type === 'get-status') {
        try {
          const res = await fetch(`${BACKEND}/api/status`);
          const data = await res.json();
          sendResponse({ ok: true, ...data });
        } catch (e) {
          sendResponse({ ok: false, error: 'backend-unreachable' });
        }
      } else if (msg.type === 'activate-license') {
        try {
          const res = await fetch(`${BACKEND}/api/license/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: msg.key }),
          });
          const data = await res.json();
          sendResponse(res.ok ? { ok: true, ...data } : { ok: false, error: data.error || 'activation-failed' });
        } catch (e) {
          sendResponse({ ok: false, error: 'backend-unreachable' });
        }
      } else if (msg.type === 'deactivate-license') {
        try {
          await fetch(`${BACKEND}/api/license`, { method: 'DELETE' });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: 'backend-unreachable' });
        }
      } else if (msg.type === 'getMappings') {
        sendResponse({ ok: true, mappings: (await getState(tabId)).mappings });
      } else if (msg.type === 'clear') {
        await deleteState(tabId);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    } finally {
      if (longOp) keepAlive(false);
    }
  })();
  return true; // async response
});

// Forget a tab's mappings when it closes.
chrome.tabs.onRemoved.addListener((tabId) => { void deleteState(tabId); });
