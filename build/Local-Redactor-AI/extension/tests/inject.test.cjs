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
