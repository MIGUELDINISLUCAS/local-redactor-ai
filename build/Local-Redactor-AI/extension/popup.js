function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

const CATEGORIES = [
  'CUSTOM', 'PERSON', 'ORGANIZATION', 'LOCATION', 'ADDRESS', 'PII',
  'EMAIL', 'PHONE', 'DATE', 'MONETARY', 'TAX_ID', 'REGISTRATION', 'URL',
];

let editIndex = -1; // which row is in edit mode

async function refresh() {
  const r = await send({ type: 'getRules' });
  renderRules(r && r.ok ? r.rules : []);
}

function renderRules(rules) {
  const list = document.getElementById('ruleList');
  const count = document.getElementById('ruleCount');
  if (count) count.textContent = String(rules.length);
  const empty = document.getElementById('noRules');
  if (!list || !empty) return;
  list.innerHTML = '';
  empty.style.display = rules.length ? 'none' : 'block';

  rules.forEach((rule, index) => {
    list.appendChild(index === editIndex ? editRow(rule, index) : viewRow(rule, index));
  });
}

function viewRow(rule, index) {
  const row = document.createElement('div');
  row.className = 'rule';

  const term = document.createElement('span');
  term.className = 'term';
  term.textContent = rule.pattern || '';
  term.title = rule.pattern || '';

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = rule.isRegex ? 'regex' : (rule.category || 'CUSTOM');

  const edit = iconBtn('✎', 'Edit rule', () => { editIndex = index; refresh(); });
  edit.classList.add('ghost');
  const del = iconBtn('🗑', 'Delete rule', async () => {
    const res = await send({ type: 'removeRule', index });
    if (res && res.ok) { editIndex = -1; renderRules(res.rules); }
  });
  del.classList.add('ghost');
  del.classList.add('danger');

  row.append(term, badge, edit, del);
  return row;
}

function editRow(rule, index) {
  const row = document.createElement('div');
  row.className = 'rule';

  const pattern = document.createElement('input');
  pattern.type = 'text';
  pattern.value = rule.pattern || '';
  pattern.autofocus = true;

  const cat = document.createElement('select');
  for (const c of CATEGORIES) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if ((rule.category || 'CUSTOM') === c) o.selected = true;
    cat.appendChild(o);
  }

  const rxWrap = document.createElement('label');
  rxWrap.className = 'rx';
  rxWrap.title = 'Treat the pattern as a regular expression';
  const rx = document.createElement('input');
  rx.type = 'checkbox';
  rx.checked = !!rule.isRegex;
  rxWrap.append(rx, document.createTextNode('.*'));

  const saveRule = async () => {
    const val = pattern.value.trim();
    if (!val) return;
    const res = await send({
      type: 'updateRule',
      index,
      rule: { pattern: val, category: cat.value, isRegex: rx.checked },
    });
    if (res && res.ok) { editIndex = -1; renderRules(res.rules); }
  };

  pattern.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveRule();
    if (e.key === 'Escape') { editIndex = -1; refresh(); }
  });

  const save = iconBtn('💾', 'Save changes', saveRule);
  save.classList.add('save');
  const cancel = iconBtn('✕', 'Cancel', () => { editIndex = -1; refresh(); });
  cancel.classList.add('ghost');

  row.append(pattern, cat, rxWrap, save, cancel);
  return row;
}

function iconBtn(txt, title, onClick) {
  const b = document.createElement('button');
  b.className = 'iconbtn';
  b.textContent = txt;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab && tab.id;

  const health = await send({ type: 'health' });
  document.getElementById('backend').innerHTML = health && health.ok
    ? '<span class="dot on"></span>running'
    : '<span class="dot off"></span>offline';

  const m = await send({ type: 'getMappings', tabId });
  document.getElementById('mappings').textContent = m && m.ok ? String(m.mappings.length) : '—';

  // Thorough-check preference (optional, self-installed model). Default off.
  const thoroughEl = document.getElementById('thorough');
  const thoroughSetup = document.getElementById('thoroughSetup');

  // Is the optional thorough model installed? Show the self-serve setup box when
  // Thorough is on but the model isn't there.
  let thoroughInstalled = false;
  try {
    const status = await send({ type: 'ner-status' });
    thoroughInstalled = !!(status && status.ok && status.thorough);
  } catch (e) { /* ignore */ }
  function syncThoroughSetup() {
    thoroughSetup.style.display = thoroughEl.checked && !thoroughInstalled ? 'block' : 'none';
  }

  try {
    const saved = await chrome.storage.local.get('lra-thorough');
    thoroughEl.checked = !!(saved && saved['lra-thorough']);
  } catch (e) { /* ignore */ }
  syncThoroughSetup();
  thoroughEl.addEventListener('change', () => {
    chrome.storage.local.set({ 'lra-thorough': thoroughEl.checked });
    syncThoroughSetup();
  });

  // License status
  try {
    const status = await send({ type: 'get-status' });
    const licenseActive = document.getElementById('licenseActive');
    const licenseTrial = document.getElementById('licenseTrial');
    const licenseExpired = document.getElementById('licenseExpired');
    const licenseInput = document.getElementById('licenseInput');
    const licenseKicker = document.getElementById('licenseKicker');
    const licenseLabel = document.getElementById('licenseLabel');
    const trialMsg = document.getElementById('trialMsg');

    if (status && status.ok && status.licensed) {
      const t = status.licenseType === 'perpetual' ? 'Perpetual' : status.licenseType === 'subscription' ? 'Subscription' : 'Extended trial';
      licenseLabel.textContent = `Active — ${t}`;
      licenseKicker.textContent = 'Licensed';
      licenseActive.style.display = '';
      licenseInput.style.display = 'none';
    } else if (status && status.ok && status.trial && !status.trial.expired) {
      trialMsg.textContent = `${status.trial.daysLeft} day${status.trial.daysLeft === 1 ? '' : 's'} left in your free trial.`;
      licenseKicker.textContent = `Trial — ${status.trial.daysLeft} day${status.trial.daysLeft === 1 ? '' : 's'} left`;
      licenseTrial.style.display = '';
      licenseInput.style.display = '';
    } else {
      licenseKicker.textContent = 'Trial ended';
      licenseExpired.style.display = '';
      licenseInput.style.display = '';
    }
  } catch (e) {
    document.getElementById('licenseKicker').textContent = 'Could not reach backend';
  }

  document.getElementById('activateBtn').addEventListener('click', async () => {
    const key = document.getElementById('keyInput').value.trim();
    const errEl = document.getElementById('keyError');
    errEl.style.display = 'none';
    if (!key) { errEl.textContent = 'Paste a license key first.'; errEl.style.display = ''; return; }
    const res = await send({ type: 'activate-license', key });
    if (res && res.ok) {
      location.reload();
    } else {
      errEl.textContent = res && res.error === 'key-expired' ? 'This key has expired.' : 'Invalid license key.';
      errEl.style.display = '';
    }
  });

  document.getElementById('deactivateBtn').addEventListener('click', async () => {
    await send({ type: 'deactivate-license' });
    location.reload();
  });

  await refresh();

  document.getElementById('clear').addEventListener('click', async () => {
    await send({ type: 'clear', tabId });
    document.getElementById('mappings').textContent = '0';
  });

  const ig = await send({ type: 'getIgnore' });
  const igCount = ig && ig.ok ? ig.ignore.length : 0;
  document.getElementById('ignoreCount').textContent = String(igCount);
}

init();
