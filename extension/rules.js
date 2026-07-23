function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

const CATEGORIES = [
  'CUSTOM', 'PERSON', 'ORGANIZATION', 'LOCATION', 'ADDRESS', 'PII',
  'EMAIL', 'PHONE', 'DATE', 'MONETARY', 'TAX_ID', 'REGISTRATION', 'URL',
];

let savedRules = [];
let ignoredTerms = [];
const notice = document.getElementById('notice');

function showNotice(message = '') {
  notice.textContent = message;
  if (message) window.setTimeout(() => { if (notice.textContent === message) notice.textContent = ''; }, 3500);
}

function makeButton(label, title, onClick, className = 'icon') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

function renderSaved() {
  const list = document.getElementById('savedList');
  list.replaceChildren();
  document.getElementById('savedCount').textContent = String(savedRules.length);
  document.getElementById('savedEmpty').hidden = savedRules.length > 0;

  savedRules.forEach((rule, index) => {
    const row = document.createElement('div');
    row.className = 'row';

    const details = document.createElement('div');
    const term = document.createElement('div');
    term.className = 'term'; term.textContent = rule.pattern || ''; term.title = rule.pattern || '';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const badge = document.createElement('span');
    badge.className = 'badge'; badge.textContent = rule.isRegex ? 'REGEX' : (rule.category || 'CUSTOM');
    meta.appendChild(badge);
    if (rule.isRegex) meta.appendChild(document.createTextNode('Pattern match'));
    details.append(term, meta);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      makeButton('Edit', 'Edit saved rule', () => renderRuleEditor(row, rule, index)),
      makeButton('Remove', 'Remove saved rule', () => removeSaved(index), 'icon danger'),
    );
    row.append(details, actions);
    list.appendChild(row);
  });
}

function renderRuleEditor(row, rule, index) {
  row.classList.add('editing');
  row.replaceChildren();
  const form = document.createElement('div');
  form.className = 'form';
  const pattern = document.createElement('input');
  pattern.type = 'text'; pattern.value = rule.pattern || ''; pattern.setAttribute('aria-label', 'Rule pattern');
  const category = document.createElement('select');
  category.setAttribute('aria-label', 'Rule category');
  CATEGORIES.forEach((value) => { const option = new Option(value, value); option.selected = (rule.category || 'CUSTOM') === value; category.appendChild(option); });
  const regexLabel = document.createElement('label');
  regexLabel.className = 'check';
  const regex = document.createElement('input');
  regex.type = 'checkbox'; regex.checked = !!rule.isRegex;
  regexLabel.append(regex, document.createTextNode('Regular expression'));
  const save = makeButton('Save', 'Save changes', async () => {
    const value = pattern.value.trim();
    if (!value) { showNotice('A saved rule cannot be empty.'); pattern.focus(); return; }
    const result = await send({ type: 'updateRule', index, rule: { pattern: value, category: category.value, isRegex: regex.checked } });
    if (result && result.ok) { savedRules = result.rules || []; renderSaved(); showNotice('Saved rule updated.'); }
  }, 'button');
  const cancel = makeButton('Cancel', 'Cancel editing', renderSaved, 'button subtle');
  form.append(pattern, category, regexLabel, save, cancel);
  row.appendChild(form);
  pattern.focus(); pattern.select();
  pattern.addEventListener('keydown', (event) => { if (event.key === 'Enter') save.click(); if (event.key === 'Escape') renderSaved(); });
}

async function removeSaved(index) {
  const rule = savedRules[index];
  if (!rule || !window.confirm(`Remove “${rule.pattern}” from saved rules?`)) return;
  const result = await send({ type: 'removeRule', index });
  if (result && result.ok) { savedRules = result.rules || []; renderSaved(); showNotice('Saved rule removed.'); }
}

function renderIgnored() {
  const list = document.getElementById('ignoredList');
  list.replaceChildren();
  document.getElementById('ignoredCount').textContent = String(ignoredTerms.length);
  document.getElementById('ignoredEmpty').hidden = ignoredTerms.length > 0;

  ignoredTerms.forEach((value, index) => {
    const row = document.createElement('div');
    row.className = 'row';
    const input = document.createElement('input');
    input.type = 'text'; input.value = value; input.setAttribute('aria-label', `Not-sensitive term ${index + 1}`);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const save = makeButton('Save', 'Save term', async () => {
      const next = input.value.trim();
      if (!next) { showNotice('A not-sensitive term cannot be empty.'); input.focus(); return; }
      if (next.toLowerCase() !== value.toLowerCase()) await send({ type: 'removeIgnore', value });
      await send({ type: 'addIgnore', value: next });
      const result = await send({ type: 'getIgnore' });
      ignoredTerms = result && result.ok ? result.ignore : ignoredTerms;
      renderIgnored(); showNotice('Not-sensitive term updated.');
    }, 'button');
    const remove = makeButton('Remove', 'Remove not-sensitive term', async () => {
      await send({ type: 'removeIgnore', value });
      ignoredTerms = ignoredTerms.filter((_, i) => i !== index);
      renderIgnored(); showNotice('Not-sensitive term removed.');
    }, 'icon danger');
    actions.append(save, remove);
    row.append(input, actions);
    list.appendChild(row);
  });
}

async function load() {
  const [rules, ignore] = await Promise.all([send({ type: 'getRules' }), send({ type: 'getIgnore' })]);
  savedRules = rules && rules.ok && Array.isArray(rules.rules) ? rules.rules : [];
  ignoredTerms = ignore && ignore.ok && Array.isArray(ignore.ignore) ? ignore.ignore : [];
  renderSaved(); renderIgnored();
}

document.getElementById('clearSaved').addEventListener('click', async () => {
  if (!savedRules.length || !window.confirm('Clear all saved rules?')) return;
  await send({ type: 'clearRules' }); savedRules = []; renderSaved(); showNotice('Saved rules cleared.');
});
document.getElementById('clearIgnored').addEventListener('click', async () => {
  if (!ignoredTerms.length || !window.confirm('Clear all not-sensitive terms?')) return;
  await send({ type: 'clearIgnore' }); ignoredTerms = []; renderIgnored(); showNotice('Not-sensitive terms cleared.');
});

load().catch(() => showNotice('Could not load privacy lists. Try reopening this page.'));
