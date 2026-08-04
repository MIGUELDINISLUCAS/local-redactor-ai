// MAIN-world script: runs in the page so it can wrap the network APIs.
//
// Two jobs:
//  1) Review + rewrite: when Protect is on, pause the "send message" fetch, ask
//     the isolated content script to anonymise + get approval, then rewrite the
//     body so ONLY the anonymised text leaves.
//  2) Outbound firewall (a best-effort safety net): block an outgoing request
//     whose body still contains a value you're protecting. A send-only rewrite is
//     not enough — providers fire other requests (drafts, retries, telemetry) and
//     change endpoints — so this scans across the transports we can wrap.
//
// SCOPE / HONEST LIMITS — this is NOT a hard security boundary:
//  - Covered: window.fetch, XMLHttpRequest, navigator.sendBeacon (main world).
//  - NOT covered: Worker / ServiceWorker fetch, WebSocket, WebTransport, form
//    submits, resource-URL params, navigations, or APIs added later.
//  - The provider's own page JavaScript already holds the raw text you typed into
//    its composer and could exfiltrate it through an un-wrapped channel.
//  - The bridge to the content script is window.postMessage, which page scripts
//    can observe/forge.
// It reliably prevents ACCIDENTAL leaks to a trusted provider; it cannot stop a
// hostile provider page. A true boundary needs an extension-owned input surface.

(() => {
  const origFetch = window.fetch;
  let protectOn = false;
  let reqSeq = 0;
  const pending = new Map(); // id -> resolve
  let protectedValues = new Set(); // values the user chose to anonymise in the active review
  let protectedMap = Object.create(null); // original value -> placeholder (for send-time scrub)
  let preparedReview = null; // short-lived approval from ChatGPT's /conversation/prepare
  let composerVetted = false; // composer holds exactly the text approved in a document review

  // ---- talk to the isolated content script ----
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__lra !== 1) return;
    if (d.type === 'protect-state') {
      protectOn = !!d.on;
    } else if (d.type === 'composer-vetted') {
      // True only while the composer holds exactly the text the user approved in
      // a document review. It is the sole condition under which we let an opaque
      // provider file upload through (see the attachment firewall below).
      composerVetted = !!d.vetted;
    } else if (d.type === 'protected-values') {
      // REPLACE (not accumulate): reflects the user's current ticked choices, so
      // unticking a value immediately stops the firewall guarding it.
      protectedValues = new Set();
      if (Array.isArray(d.list)) {
        for (const v of d.list) {
          if (typeof v === 'string' && v.trim().length >= 3) protectedValues.add(v);
        }
      }
      protectedMap = Object.create(null);
      if (d.map && typeof d.map === 'object') {
        for (const k of Object.keys(d.map)) {
          if (typeof d.map[k] === 'string') protectedMap[k] = d.map[k];
        }
      }
    } else if (d.type === 'review-response') {
      const resolve = pending.get(d.id);
      if (resolve) { pending.delete(d.id); resolve(d); }
    }
  });

  function requestReview(text) {
    const id = ++reqSeq;
    return new Promise((resolve) => {
      // A content-script reload or provider navigation must not leave the original
      // fetch suspended forever. Timeout resolves as a cancellation (fail closed).
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ id, approved: false, error: 'review-timeout' });
      }, 5 * 60 * 1000);
      pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      window.postMessage({ __lra: 1, type: 'review-request', id, text }, '*');
    });
  }

  // Endpoints where a protected value being present is EXPECTED and harmless to
  // block: the provider auto-generates a conversation title/rename from its own
  // copy of your original text and ships it separately. We still block these
  // (the title is stored server-side), but quietly — no scary warning.
  // Provider blob storage. ChatGPT silently converts a long pasted message into
  // a file attachment and PUTs the raw bytes here. Blocking that is correct —
  // it carries the ORIGINAL text, which we cannot read to anonymise — but the
  // user never attached anything, so "remove the attached file" reads as
  // nonsense. Classified separately to explain what actually happened.
  function isProviderFileStoreUrl(url) {
    return /oaiusercontent\.com|\/files\/[^?]*\/raw(?:[?#]|$)/.test(url || '');
  }

  function isExpectedBlockUrl(url) {
    return /\/(gen_title|title|rename)\b/.test(url || '')
      || /\/backend-api\/(files|global\/search)\b/.test(url || '')
      || /\/realtime\//.test(url || '');
  }

  function reportLeakBlocked(reason, detail) {
    // "routine" = expected and no user action needed: the constant draft/keystroke
    // stream, or a provider auto-title endpoint. Those log quietly and show no
    // banner. A protected value about to leave via any OTHER request is genuinely
    // noteworthy — log it loud and surface it. Build a readable one-line message
    // so console/error viewers don't show a useless "[object Object]".
    const url = (detail && detail.url) || '(unknown url)';
    const val = (detail && detail.value) || '(unknown)';
    const draftStream = val === '(draft/keystroke stream)';
    const routine = draftStream || isExpectedBlockUrl(url);
    try {
      if (routine) {
        const what = draftStream ? 'draft/keystroke stream' : `"${val}"`;
        console.debug(`[Local Redactor] held ${what} (expected) → ${url}`);
      } else {
        console.warn(`[Local Redactor] blocked "${val}" from leaving → ${url}`);
      }
    } catch (e) { /* ignore */ }
    window.postMessage({ __lra: 1, type: 'leak-blocked', reason, routine }, '*');
  }

  // ---- the firewall: does this body still carry something we protect? ----
  // ChatGPT puts an IANA timezone (e.g. "Europe/Lisbon") in every request; that
  // is not your data leaking, so ignore matches inside a timezone field before
  // scanning.
  // Match a protected value as a WHOLE token, not a substring, so "ena" doesn't
  // match inside "Ethena" or random telemetry. For alphanumeric/space values we
  // use word boundaries; for values with punctuation (emails, IBANs, phones) a
  // plain substring is the right test.
  function valueHit(scan, v) {
    if (/^[\w][\w ]*[\w]$|^[\w]$/.test(v)) {
      const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('\\b' + esc + '\\b', 'i').test(scan);
    }
    return scan.includes(v);
  }
  function bodyLeaks(bodyStr) {
    if (!protectOn || typeof bodyStr !== 'string' || !bodyStr) return null;
    if (!protectedValues.size) return null;
    const scan = bodyStr.replace(/"timezone"\s*:\s*"[^"]*"/gi, '"timezone":""');
    for (const v of protectedValues) {
      if (valueHit(scan, v)) return v;
    }
    return null;
  }

  // Replace protected values that survive into a reviewed SEND outside the
  // rewritten user text (e.g. an attachment filename like "Hugo's CV.pdf") with
  // their placeholders — so we anonymise instead of hard-blocking the user. Only
  // used on the recognised send request, never as a substitute for the firewall.
  function scrubProtected(bodyStr) {
    if (typeof bodyStr !== 'string' || !bodyStr) return bodyStr;
    let out = bodyStr;
    // Longest values first so a shorter protected value can't partially clobber a
    // longer overlapping one.
    const pairs = Object.keys(protectedMap)
      .filter((k) => protectedMap[k])
      .sort((a, b) => b.length - a.length);
    for (const orig of pairs) {
      const ph = protectedMap[orig];
      if (/^[\w][\w ]*[\w]$|^[\w]$/.test(orig)) {
        const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp('\\b' + esc + '\\b', 'gi'), ph);
      } else {
        out = out.split(orig).join(ph);
      }
    }
    return out;
  }

  // Endpoints that stream your *composer / draft* text somewhere other than the
  // reviewed send — e.g. ChatGPT's "writing-blocks" analyser fires as you type
  // and carries the raw text. While Protect is on these must NEVER go out: the
  // value may not be in knownOriginals yet (detection hasn't run on a brand-new
  // name), so a content scan can't catch it. Block them unconditionally.
  function isDraftLeakUrl(url) {
    return (
      /\/conversation\/message\/writing-blocks\b/.test(url) ||
      /\/writing-blocks\b/.test(url) ||
      /\/draft\b/.test(url)
    );
  }

  // ---- recognise the provider's "send message" request ----
  function isPrepareUrl(url) {
    return /\/backend-api\/(?:f\/)?conversation\/prepare(?:[?#]|$)/.test(url || '');
  }

  function isSendUrl(url) {
    return (
      /\/backend-api\/(?:f\/)?conversation(?:[?#]|$)/.test(url) || // ChatGPT final send
      isPrepareUrl(url) || // ChatGPT pre-send request (carries partial_query)
      /\/chat_conversations\/[^/]+\/(?:retry_)?completion(?:[?#]|$)/.test(url) || // Claude
      /\/completion(?:[?#]|$)/.test(url)
    );
  }

  // Returns { text, put(anonymised) } or null if we can't find user text.
  // Handles several provider payload shapes:
  //   ChatGPT : messages[].author.role==='user', content.parts (strings)
  //   Claude  : top-level "prompt" string
  //   Claude/generic messages: messages[].role==='user' with content as a
  //             string, or an array of { type:'text', text }
  function textFromPart(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return null;
    if (typeof part.text === 'string') return part.text;
    if (
      typeof part.content === 'string' &&
      (part.type === 'text' || part.type === 'input_text' || part.content_type === 'text')
    ) return part.content;
    if (typeof part.value === 'string' && (part.type === 'text' || part.type === 'input_text')) return part.value;
    return null;
  }

  function putPartText(part, value) {
    if (typeof part === 'string') return value;
    if (part && typeof part === 'object') {
      if (typeof part.text === 'string') part.text = value;
      else if (typeof part.content === 'string') part.content = value;
      else if (typeof part.value === 'string') part.value = value;
    }
    return part;
  }

  function locateInMessages(messages) {
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!m) continue;
        const role = (m.author && m.author.role) || m.role;
        if (role && role !== 'user') continue;

        // ChatGPT: content.parts may contain strings or newer object-based text
        // parts ({type/content_type:'text', text/content/value:'...'}).
        const parts = m.content && m.content.parts;
        if (Array.isArray(parts) && parts.some((p) => textFromPart(p) !== null)) {
          const text = parts.map(textFromPart).filter((p) => typeof p === 'string').join('\n');
          return {
            text,
            // The whole message is folded into the FIRST text part, so the extra
            // text parts must be dropped — not blanked. Emptying them left
            // `{type:'text', text:''}` entries behind (the old filter only removed
            // empty *strings*, never emptied objects), and a payload carrying
            // empty text parts can be rejected by the provider, so the anonymised
            // message never actually sent.
            put: (anon) => {
              let placed = false;
              m.content.parts = parts
                .map((p) => {
                  if (textFromPart(p) === null) return p; // keep images/attachments
                  if (!placed) { placed = true; return putPartText(p, anon); }
                  return null; // folded into the first part — drop it
                })
                .filter((p) => p !== null && p !== '');
            },
          };
        }

        // Claude/generic: content is a plain string
        if (typeof m.content === 'string' && m.content.trim()) {
          return { text: m.content, put: (anon) => { m.content = anon; } };
        }

        // Claude/Responses-style content arrays. Preserve non-text blocks such as
        // images and attachments; collapse only the user-visible text blocks.
        if (Array.isArray(m.content)) {
          const textBlocks = m.content.filter((c) => textFromPart(c) !== null);
          if (textBlocks.length) {
            const text = textBlocks.map(textFromPart).join('\n');
            return {
              text,
              // As above: fold all text into the first block and REMOVE the rest,
              // rather than leaving blanked-out text blocks in the payload.
              put: (anon) => {
                let placed = false;
                m.content = m.content.filter((c) => {
                  if (textFromPart(c) === null) return true; // keep non-text blocks
                  if (!placed) { placed = true; putPartText(c, anon); return true; }
                  return false;
                });
              },
            };
          }
        }

        // Some message schemas use content: { text: '...' } without parts.
        if (m.content && typeof m.content === 'object' && typeof m.content.text === 'string') {
          return { text: m.content.text, put: (anon) => { m.content.text = anon; } };
        }
      }
    }
    return null;
  }

  function locateUserText(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;

    const fromMessages = locateInMessages(parsed.messages);
    if (fromMessages) return fromMessages;

    // Current/experimental schemas sometimes send one top-level message.
    if (parsed.message && typeof parsed.message === 'object') {
      const fromMessage = locateInMessages([parsed.message]);
      if (fromMessage) return fromMessage;
    }

    // Responses-style input: either a direct string or an array of message items.
    if (typeof parsed.input === 'string' && parsed.input.trim()) {
      return { text: parsed.input, put: (anon) => { parsed.input = anon; } };
    }
    if (Array.isArray(parsed.input)) {
      const fromInput = locateInMessages(parsed.input);
      if (fromInput) return fromInput;
    }

    // ChatGPT's pre-send /conversation/prepare request carries the composer text
    // here, before the final messages[] request. It must be reviewed and rewritten
    // too, otherwise the raw draft leaves during preparation.
    if (typeof parsed.partial_query === 'string' && parsed.partial_query.trim()) {
      return { text: parsed.partial_query, put: (anon) => { parsed.partial_query = anon; } };
    }

    // Claude / others: top-level prompt string
    if (typeof parsed.prompt === 'string' && parsed.prompt.trim()) {
      return { text: parsed.prompt, put: (anon) => { parsed.prompt = anon; } };
    }
    return null;
  }

  // Does this parsed body carry any actual USER MESSAGE text? Many requests on
  // the send URL don't: conversation/init creates an empty chat, and prepare
  // pre-flights ship only metadata with messages:[]. Those have nothing to
  // anonymise — distinguishing them stops the false "could not read the message"
  // block on ordinary ChatGPT traffic.
  function hasUserContent(parsed, located) {
    if (!parsed || typeof parsed !== 'object') return false;
    if (located && typeof located.text === 'string' && located.text.trim()) return true;

    // A non-empty user content structure that locateUserText does not understand
    // is still message content. Return true so the caller blocks it as an unknown
    // shape instead of misclassifying it as harmless metadata and sending it raw.
    const messageCandidates = [
      ...(Array.isArray(parsed.messages) ? parsed.messages : []),
      ...(parsed.message && typeof parsed.message === 'object' ? [parsed.message] : []),
      ...(Array.isArray(parsed.input) ? parsed.input : []),
    ];
    for (const m of messageCandidates) {
        if (!m) continue;
        const role = (m.author && m.author.role) || m.role;
        if (role && role !== 'user') continue;
        if (typeof m.content === 'string' && m.content.trim()) return true;
        if (Array.isArray(m.content) && m.content.length) return true;
        if (m.content && typeof m.content === 'object') {
          const parts = m.content.parts;
          if (Array.isArray(parts) && parts.length) return true;
          if (typeof m.content.text === 'string' && m.content.text.trim()) return true;
          if (Object.keys(m.content).length) return true;
        }
    }
    for (const k of ['prompt', 'input', 'partial_query']) {
      if (typeof parsed[k] === 'string' && parsed[k].trim()) return true;
    }
    if (Array.isArray(parsed.input) && parsed.input.length) return true;
    return false;
  }

  function logPayloadShape(url, parsed, bodyStr) {
    try {
      const describeMessage = (m) => ({
        role: (m && m.author && m.author.role) || (m && m.role) || '(none)',
        keys: m && typeof m === 'object' ? Object.keys(m) : [],
        contentType: m && (Array.isArray(m.content) ? 'array' : typeof m.content),
        contentKeys: m && m.content && typeof m.content === 'object' && !Array.isArray(m.content)
          ? Object.keys(m.content)
          : [],
        partTypes: m && m.content && Array.isArray(m.content.parts)
          ? m.content.parts.slice(0, 6).map((p) => typeof p === 'object' && p ? (p.type || p.content_type || 'object') : typeof p)
          : [],
      });
      console.warn('[Local Redactor] unrecognised send payload shape:', JSON.stringify({
        url,
        bodyType: typeof bodyStr,
        keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
        messages: parsed && Array.isArray(parsed.messages) ? parsed.messages.slice(-3).map(describeMessage) : [],
        message: parsed && parsed.message ? describeMessage(parsed.message) : undefined,
        inputType: parsed && (Array.isArray(parsed.input) ? 'array' : typeof parsed.input),
      }));
    } catch (e) { /* diagnostic logging must never affect the send decision */ }
  }

  // ---- attachment firewall: block RAW file uploads while Protect is on -------
  // Files attached via the provider's own "+" button upload as FormData/Blob/
  // ArrayBuffer (or a signed-URL PUT of raw bytes) — a body we CANNOT read as
  // text, so we can't anonymise or scan it. Fail safe: block it, and tell the
  // user to attach via the 📎 button (which extracts + anonymises text locally).
  function isFileLikeBody(body) {
    if (!body) return false;
    if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
    if (typeof Blob !== 'undefined' && body instanceof Blob) return true; // File extends Blob
    if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return true;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(body)) return true;
    return false;
  }
  function looksBinaryContentType(ct) {
    return !!ct && /multipart\/form-data|application\/octet-stream|^image\/|^audio\/|^video\/|application\/pdf|officedocument|application\/(zip|x-)/i.test(ct);
  }

  const isRequest = (x) => typeof Request !== 'undefined' && x instanceof Request;

  // ===================== fetch =====================
  window.fetch = async function (input, init) {
    const reqObj = isRequest(input);
    const url = reqObj ? input.url : String(input);
    const method = (init && init.method) || (reqObj ? input.method : 'GET') || 'GET';
    const isPost = /post|put|patch/i.test(method);

    if (protectOn && isDraftLeakUrl(url)) {
      reportLeakBlocked('firewall', { url, value: '(draft/keystroke stream)' });
      throw new DOMException('Blocked: draft text stream while Protect on', 'AbortError');
    }

    // Block raw file uploads (native "+" attach) — we can't scan a binary body.
    // Skip realtime/streaming endpoints — their binary frames aren't file uploads.
    if (protectOn && isPost && !/\/realtime\//.test(url)) {
      const body = init && init.body;
      let fileUpload = isFileLikeBody(body);
      if (!fileUpload && reqObj) {
        try { fileUpload = looksBinaryContentType(input.headers && input.headers.get && input.headers.get('content-type')); } catch (e) { /* ignore */ }
      }
      if (fileUpload) {
        // The provider auto-uploading a message we already anonymised is the one
        // safe case: the composer still holds exactly the reviewed text, so the
        // bytes going up are the anonymised ones. Any edit clears composerVetted.
        if (isProviderFileStoreUrl(url) && composerVetted) {
          try {
            console.debug(`[Local Redactor] allowed anonymised document upload → ${url}`);
          } catch (e) { /* ignore */ }
          return origFetch.apply(this, [input, init]);
        }
        reportLeakBlocked(isProviderFileStoreUrl(url) ? 'attachment-autofile' : 'attachment', {
          url,
          value: '(file attachment)',
        });
        return Response.error();
      }
    }

    if (protectOn && isPost) {
      // Read the body once (string only) so we can both rewrite and firewall it.
      let bodyStr = init && typeof init.body === 'string' ? init.body : null;
      if (bodyStr == null && reqObj && !input.bodyUsed) {
        try { bodyStr = await input.clone().text(); } catch (e) { bodyStr = null; }
      }

      // 1) Review + rewrite the recognised "send" request.
      if (isSendUrl(url)) {
        // A provider payload change is exactly when protection matters most. If we
        // cannot read and recognise the body, do not fall through to the original
        // fetch: on a first send the protected-values firewall is still empty and
        // would otherwise allow the raw message out.
        if (bodyStr == null) {
          reportLeakBlocked('structure', { url, value: '(unreadable send body)' });
          throw new DOMException('Blocked: could not read message body', 'AbortError');
        }
        let parsed = null;
        try { parsed = JSON.parse(bodyStr || ''); } catch (e) { parsed = null; }

        // Send-URL requests that carry NO user message — conversation/init, a
        // prepare pre-flight with messages:[] — have nothing to anonymise. Skip
        // the review and let the firewall below guard them, instead of blocking
        // with a false "could not read the message" error. (The firewall still
        // catches any protected value that somehow rides along.)
        const loc = locateUserText(parsed);
        const carriesUserContent = hasUserContent(parsed, loc);
        if (!carriesUserContent) {
          if (!parsed || typeof parsed !== 'object') {
            // A send-shaped URL with an unreadable / non-JSON body: we can't scan
            // it, and on a first send the firewall is still empty — fail safe.
            logPayloadShape(url, parsed, bodyStr);
            reportLeakBlocked('structure', { url, value: '(unrecognised send body)' });
            throw new DOMException('Blocked: unrecognised message format', 'AbortError');
          }
          // Parsed metadata-only request → fall through to the firewall.
        } else if (loc && loc.text && loc.text.trim()) {
          let approvedText = null;
          const cached = preparedReview && preparedReview.expiresAt > Date.now() ? preparedReview : null;
          if (!isPrepareUrl(url) && cached && (loc.text === cached.original || loc.text === cached.anonymised)) {
            // The user already approved this exact text in /prepare moments ago.
            // Reuse it so ChatGPT's two-stage send produces only one review dialog.
            approvedText = cached.anonymised;
            preparedReview = null;
          } else {
            const review = await requestReview(loc.text);
            if (!review || !review.approved) {
              throw new DOMException('Cancelled by Local Redactor', 'AbortError');
            }
            approvedText = review.text;
            if (isPrepareUrl(url)) {
              preparedReview = {
                original: loc.text,
                anonymised: approvedText,
                expiresAt: Date.now() + 30 * 1000,
              };
            }
          }
          loc.put(approvedText);
          bodyStr = JSON.stringify(parsed);
          // fall through to the firewall check below with the rewritten body
        } else {
          // There IS user content but we couldn't extract it (a provider payload
          // change hid the text somewhere we don't parse). Fail safe: block rather
          // than risk sending it raw. Log the shape so it can be diagnosed.
          try {
            const shape = {
              url,
              keys: parsed && Object.keys(parsed),
              messages: Array.isArray(parsed.messages)
                ? parsed.messages.map((m) => ({
                    role: (m && m.author && m.author.role) || (m && m.role),
                    contentType: m && (Array.isArray(m.content) ? 'array' : typeof m.content),
                  }))
                : undefined,
            };
            console.warn('[Local Redactor] could not locate message text in send payload:', JSON.stringify(shape));
          } catch (e) { /* ignore */ }
          logPayloadShape(url, parsed, bodyStr);
          reportLeakBlocked('structure', { url, value: '(missing user text)' });
          throw new DOMException('Blocked: could not anonymise message', 'AbortError');
        }
      }

      // 2) Firewall: whatever this request is, it must not carry a protected
      //    value. Catches title-generation, edits, retries, telemetry, and any
      //    send path we didn't specifically rewrite.
      let leak = bodyLeaks(bodyStr);
      // On the recognised send, a protected value can survive OUTSIDE the
      // rewritten text (e.g. an attachment filename). Scrub it to its placeholder
      // and re-check, rather than blocking the user's whole message.
      if (leak && isSendUrl(url)) {
        const scrubbed = scrubProtected(bodyStr);
        if (scrubbed !== bodyStr) { bodyStr = scrubbed; leak = bodyLeaks(bodyStr); }
      }
      if (leak) {
        reportLeakBlocked('firewall', { url, value: leak });
        throw new DOMException('Blocked: protected value in outgoing request', 'AbortError');
      }

      // Re-issue with the (possibly rewritten) body.
      if (bodyStr != null) {
        return reqObj
          ? origFetch.call(this, new Request(input, { body: bodyStr }))
          : origFetch.call(this, input, Object.assign({}, init || {}, { body: bodyStr }));
      }
    }

    return origFetch.apply(this, [input, init]);
  };

  // ===================== XMLHttpRequest =====================
  const XHRsend = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
  if (XHRsend) {
    const XHRopen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (m, u) {
      this.__lra_url = u;
      return XHRopen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function (body) {
      if (protectOn) {
        if (isDraftLeakUrl(this.__lra_url || '')) {
          reportLeakBlocked('firewall', { url: this.__lra_url || '(xhr)', value: '(draft/keystroke stream)' });
          try { this.abort(); } catch (e) { /* ignore */ }
          return;
        }
        if (isFileLikeBody(body)) {
          reportLeakBlocked(isProviderFileStoreUrl(this.__lra_url) ? 'attachment-autofile' : 'attachment', {
            url: this.__lra_url || '(xhr)',
            value: '(file attachment)',
          });
          try { this.abort(); } catch (e) { /* ignore */ }
          return;
        }
        const leak = typeof body === 'string' ? bodyLeaks(body) : null;
        if (leak) {
          reportLeakBlocked('firewall', { url: this.__lra_url || '(xhr)', value: leak });
          try { this.abort(); } catch (e) { /* ignore */ }
          return; // refuse to send
        }
      }
      return XHRsend.apply(this, arguments);
    };
  }

  // ===================== sendBeacon =====================
  if (navigator.sendBeacon) {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (protectOn) {
        if (isDraftLeakUrl(String(url))) {
          reportLeakBlocked('firewall', { url, value: '(draft/keystroke stream)' });
          return false;
        }
        if (isFileLikeBody(data)) {
          reportLeakBlocked(isProviderFileStoreUrl(url) ? 'attachment-autofile' : 'attachment', {
            url,
            value: '(file attachment)',
          });
          return false;
        }
        const leak = typeof data === 'string' ? bodyLeaks(data) : null;
        if (leak) {
          reportLeakBlocked('firewall', { url, value: leak });
          return false; // refuse to send
        }
      }
      return origBeacon(url, data);
    };
  }

  // Announce we're ready so the isolated script can push the current state.
  window.postMessage({ __lra: 1, type: 'inject-ready' }, '*');
})();
