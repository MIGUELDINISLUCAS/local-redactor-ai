const test = require('node:test');
const assert = require('node:assert/strict');

test('rewrites current object-part and singular-message payloads and blocks unknown shapes', async () => {
  const sent = [];
  let reviewRequests = 0;
  let messageHandler;
  const page = {
    fetch: async (input, init) => {
      sent.push({ input, init });
      return { ok: true };
    },
    addEventListener: (type, fn) => { if (type === 'message') messageHandler = fn; },
    postMessage: (data) => {
      if (data.type !== 'review-request') return;
      reviewRequests++;
      queueMicrotask(() => messageHandler({
        source: page,
        data: { __lra: 1, type: 'review-response', id: data.id, approved: true, text: '[PERSON_001]' },
      }));
    },
    XMLHttpRequest: undefined,
  };

  global.window = page;
  Object.defineProperty(global, 'navigator', { configurable: true, value: { sendBeacon: null } });
  require('../inject.js');
  messageHandler({ source: page, data: { __lra: 1, type: 'protect-state', on: true } });

  const objectPart = {
    action: 'next',
    messages: [{
      author: { role: 'user' },
      content: { parts: [{ content_type: 'text', text: 'Alice Smith' }] },
    }],
  };
  await page.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST', body: JSON.stringify(objectPart),
  });
  assert.equal(JSON.parse(sent[0].init.body).messages[0].content.parts[0].text, '[PERSON_001]');

  const singularMessage = {
    message: { role: 'user', content: [{ type: 'input_text', text: 'Bob Jones' }] },
  };
  await page.fetch('https://chatgpt.com/backend-api/conversation', {
    method: 'POST', body: JSON.stringify(singularMessage),
  });
  assert.equal(JSON.parse(sent[1].init.body).message.content[0].text, '[PERSON_001]');

  const prepare = { action: 'next', messages: [], partial_query: 'Carol White' };
  await page.fetch('https://chatgpt.com/backend-api/f/conversation/prepare', {
    method: 'POST', body: JSON.stringify(prepare),
  });
  assert.equal(JSON.parse(sent[2].init.body).partial_query, '[PERSON_001]');

  const afterPrepare = {
    messages: [{ author: { role: 'user' }, content: { parts: ['Carol White'] } }],
  };
  await page.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST', body: JSON.stringify(afterPrepare),
  });
  assert.equal(JSON.parse(sent[3].init.body).messages[0].content.parts[0], '[PERSON_001]');
  assert.equal(reviewRequests, 3, 'prepare approval should be reused by the final send');

  // Sub-endpoints are not final sends. Feedback without protected values should
  // pass normally rather than being misclassified as an unreadable message.
  await page.fetch('https://chatgpt.com/backend-api/conversation/implicit_message_feedback', {
    method: 'POST', body: JSON.stringify({ message_id: 'm1', feedback: 'thumbs_up' }),
  });
  assert.equal(sent.length, 5);

  await assert.rejects(
    page.fetch('https://chatgpt.com/backend-api/conversation', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: { mystery: ['Alice Smith'] } }] }),
    }),
    { name: 'AbortError' }
  );
  assert.equal(sent.length, 5, 'unknown final-send shape must not reach the network');
});

// A long message can arrive split across several text parts. The whole message
// is folded into the first part, so the leftover parts must be REMOVED — blanking
// them left `{type:'text', text:''}` entries in the payload, which the provider
// can reject, so the anonymised message never actually sent.
test('folds multi-part messages into one part and drops the emptied parts', async () => {
  const sent = [];
  let messageHandler;
  const page = {
    fetch: async (input, init) => { sent.push({ input, init }); return { ok: true }; },
    addEventListener: (type, fn) => { if (type === 'message') messageHandler = fn; },
    postMessage: (data) => {
      if (data.type !== 'review-request') return;
      queueMicrotask(() => messageHandler({
        source: page,
        data: { __lra: 1, type: 'review-response', id: data.id, approved: true, text: 'SAFE TEXT' },
      }));
    },
    XMLHttpRequest: undefined,
  };
  global.window = page;
  Object.defineProperty(global, 'navigator', { configurable: true, value: { sendBeacon: null } });
  delete require.cache[require.resolve('../inject.js')];
  require('../inject.js');
  messageHandler({ source: page, data: { __lra: 1, type: 'protect-state', on: true } });

  // Object-style parts (current ChatGPT schema), plus a non-text part to preserve.
  await page.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{
        author: { role: 'user' },
        content: {
          parts: [
            { content_type: 'text', text: 'first chunk' },
            { content_type: 'text', text: 'second chunk' },
            { content_type: 'image_asset_pointer', asset_pointer: 'file-123' },
          ],
        },
      }],
    }),
  });

  const parts = JSON.parse(sent[0].init.body).messages[0].content.parts;
  const textParts = parts.filter((p) => p && typeof p.text === 'string');
  assert.equal(textParts.length, 1, 'emptied text parts must be dropped, not blanked');
  assert.equal(textParts[0].text, 'SAFE TEXT');
  assert.ok(
    parts.some((p) => p && p.content_type === 'image_asset_pointer'),
    'non-text parts must be preserved'
  );
  assert.equal(
    parts.some((p) => p && typeof p.text === 'string' && p.text === ''),
    false,
    'no empty text part may survive in the payload'
  );
});

// An opaque provider file upload is normally refused. The one exception is a
// message we already anonymised: the composer still holds exactly the reviewed
// text, so the bytes going up are the anonymised ones.
test('allows a provider auto-file upload only while the composer is vetted', async () => {
  const sent = [];
  let messageHandler;
  const page = {
    fetch: async (input, init) => { sent.push({ input, init }); return { ok: true }; },
    addEventListener: (type, fn) => { if (type === 'message') messageHandler = fn; },
    postMessage: () => {},
    XMLHttpRequest: undefined,
  };
  global.window = page;
  Object.defineProperty(global, 'navigator', { configurable: true, value: { sendBeacon: null } });
  delete require.cache[require.resolve('../inject.js')];
  require('../inject.js');
  messageHandler({ source: page, data: { __lra: 1, type: 'protect-state', on: true } });

  const AUTOFILE = 'https://sdmntprwestus3.oaiusercontent.com/files/abc-123/raw?se=2026-08-04&sp=w&sig=zz';
  const USER_FILE = 'https://chatgpt.com/backend-api/files/upload';
  const body = () => new ArrayBuffer(16);

  // 1. Not vetted -> the auto-file upload must be refused.
  await page.fetch(AUTOFILE, { method: 'PUT', body: body() });
  assert.equal(sent.length, 0, 'unvetted auto-file upload must not reach the network');

  // 2. Vetted -> the same upload is allowed through.
  messageHandler({ source: page, data: { __lra: 1, type: 'composer-vetted', vetted: true } });
  await page.fetch(AUTOFILE, { method: 'PUT', body: body() });
  assert.equal(sent.length, 1, 'vetted auto-file upload should be allowed');

  // 3. Vetted must NOT wave through a genuine user attachment elsewhere.
  await page.fetch(USER_FILE, { method: 'POST', body: body() });
  assert.equal(sent.length, 1, 'a real file attachment stays blocked even when vetted');

  // 4. Editing the composer clears the vetting, so uploads are refused again.
  messageHandler({ source: page, data: { __lra: 1, type: 'composer-vetted', vetted: false } });
  await page.fetch(AUTOFILE, { method: 'PUT', body: body() });
  assert.equal(sent.length, 1, 'editing the composer must re-block the upload');
});
