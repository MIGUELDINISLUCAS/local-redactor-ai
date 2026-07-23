import { useChatStore } from '../store/chatStore';
import { useRulesStore, rulesToPayload } from '../store/rulesStore';
import { getModel } from '../store/modelStore';
import { processTextStream, anonymise, mockProvider, providerComplete, restore } from '../utils/api';
import { randomUUID } from '../utils/uuid';
import type { PlaceholderMapping } from '../types';

function mergeMappings(
  prior: PlaceholderMapping[],
  next: PlaceholderMapping[]
): PlaceholderMapping[] {
  const map = new Map(prior.map((m) => [m.placeholder, m]));
  for (const m of next) map.set(m.placeholder, m);
  return Array.from(map.values());
}

// Holds the in-flight detection so the user can cancel it. Module-level so it
// survives re-renders and is shared across the hook's consumers.
let activeController: AbortController | null = null;

export function useChatActions() {
  const store = useChatStore;

  // Cancel an in-progress local-model scan. Aborts the request (which the
  // backend observes via the closed connection and stops the model calls).
  function cancel() {
    activeController?.abort();
    activeController = null;
    const s = store.getState();
    s.setNerProgress(null);
    s.setBusy(false);
  }

  // Combine the typed input with any attached file text.
  function buildPrompt(): string {
    const s = store.getState();
    const parts: string[] = [];
    if (s.input.trim()) parts.push(s.input.trim());
    for (const a of s.attachments) {
      parts.push(`\n--- ${a.name} ---\n${a.text}`);
    }
    return parts.join('\n');
  }

  // Send straight through: anonymise -> (send or copy) -> restore.
  async function sendDirect() {
    const s = store.getState();
    const prompt = buildPrompt();
    if (!prompt.trim()) return;
    s.setBusy(true);
    activeController = new AbortController();
    try {
      const rules = rulesToPayload(useRulesStore.getState().rules);
      const proc = await processTextStream(
        prompt, s.runningMappings, rules,
        (done, total) => s.setNerProgress({ done, total }),
        activeController.signal
      );
      s.setNerProgress(null);
      // nerPartial means Ollama IS reachable but this one call failed (e.g. a
      // slow cold-load timed out) — that's not "offline", so don't flag it.
      s.setNerAvailable(proc.nerUsed || proc.nerPartial);

      // Safety gate: if name/organization detection failed (e.g. a long document
      // timed out), do NOT silently send. Force the review screen so the user
      // can see that only structured data was redacted before anything leaves.
      if (proc.nerPartial) {
        s.setReview({
          originalText: prompt,
          anonymisedText: proc.anonymisedText,
          entities: proc.entities,
          nerPartial: true,
        });
        return;
      }

      const merged = mergeMappings(s.runningMappings, proc.mappings);
      s.setRunningMappings(merged);

      s.addMessage({
        id: randomUUID(),
        role: 'user',
        content: prompt,
        anonymisedCount: proc.entities.length,
      });
      s.setInput('');
      s.clearAttachments();

      if (s.mode === 'approved-external') {
        await runProvider(prompt, proc.anonymisedText, merged);
      } else {
        // Private local: surface the anonymised text for manual copy/paste.
        s.setLocalPending({ original: prompt, anonymisedText: proc.anonymisedText });
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        s.addMessage({ id: randomUUID(), role: 'system', content: `Error: ${e.message}` });
      }
    } finally {
      activeController = null;
      s.setNerProgress(null);
      s.setBusy(false);
    }
  }

  // Open the review panel before sending.
  async function startReview() {
    const s = store.getState();
    const prompt = buildPrompt();
    if (!prompt.trim()) return;
    s.setBusy(true);
    activeController = new AbortController();
    try {
      const rules = rulesToPayload(useRulesStore.getState().rules);
      const proc = await processTextStream(
        prompt, s.runningMappings, rules,
        (done, total) => s.setNerProgress({ done, total }),
        activeController!.signal
      );
      s.setNerProgress(null);
      // nerPartial means Ollama IS reachable but this one call failed (e.g. a
      // slow cold-load timed out) — that's not "offline", so don't flag it.
      s.setNerAvailable(proc.nerUsed || proc.nerPartial);
      s.setReview({
        originalText: prompt,
        anonymisedText: proc.anonymisedText,
        entities: proc.entities,
        nerPartial: proc.nerPartial,
      });
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        s.addMessage({ id: randomUUID(), role: 'system', content: `Error: ${e.message}` });
      }
    } finally {
      activeController = null;
      s.setNerProgress(null);
      s.setBusy(false);
    }
  }

  // Approve from the review panel -> re-anonymise with toggles, then send/copy.
  async function approveReview() {
    const s = store.getState();
    if (!s.review) return;
    s.setBusy(true);
    try {
      const { anonymisedText, mappings } = await anonymise(
        s.review.originalText,
        s.review.entities,
        s.runningMappings
      );
      const merged = mergeMappings(s.runningMappings, mappings);
      s.setRunningMappings(merged);

      s.addMessage({
        id: randomUUID(),
        role: 'user',
        content: s.review.originalText,
        anonymisedCount: s.review.entities.filter((e) => e.include).length,
      });
      s.setReview(null);
      s.setInput('');
      s.clearAttachments();

      if (s.mode === 'approved-external') {
        await runProvider(s.review.originalText, anonymisedText, merged);
      } else {
        s.setLocalPending({ original: s.review.originalText, anonymisedText });
      }
    } catch (e: any) {
      s.addMessage({ id: randomUUID(), role: 'system', content: `Error: ${e.message}` });
    } finally {
      s.setNerProgress(null);
      s.setBusy(false);
    }
  }

  // Build the ANONYMISED conversation history from prior exchanges so the model
  // has memory. Both fields are placeholder-only — original data never leaves.
  function buildHistory() {
    return store
      .getState()
      .messages.filter((m) => m.role === 'assistant' && m.record)
      .flatMap((m) => [
        { role: 'user' as const, content: m.record!.anonymisedPrompt },
        { role: 'assistant' as const, content: m.record!.llmOutput },
      ]);
  }

  // Approved-external: send ONLY the anonymised text to the selected provider,
  // then restore the reply locally. The mapping never leaves the client.
  async function runProvider(original: string, anonymisedText: string, mappings: PlaceholderMapping[]) {
    const s = store.getState();
    const raw =
      s.provider === 'mock'
        ? await mockProvider(anonymisedText)
        : (await providerComplete(s.provider, anonymisedText, getModel(s.provider), s.webSearch, buildHistory())).output;
    const restored = await restore(raw, mappings);
    s.addMessage({
      id: randomUUID(),
      role: 'assistant',
      content: restored.restoredText,
      warningCount: restored.warnings.length,
      record: {
        original,
        anonymisedPrompt: anonymisedText,
        llmOutput: raw,
        restoredOutput: restored.restoredText,
        mode: 'approved-external',
        timestamp: new Date().toISOString(),
      },
    });
  }

  // Private-local: user pastes the LLM output back; restore it locally.
  async function restorePasted(pasted: string) {
    const s = store.getState();
    if (!s.localPending) return;
    const { original, anonymisedText } = s.localPending;
    s.setBusy(true);
    try {
      const restored = await restore(pasted, s.runningMappings);
      s.addMessage({
        id: randomUUID(),
        role: 'assistant',
        content: restored.restoredText,
        warningCount: restored.warnings.length,
        record: {
          original,
          anonymisedPrompt: anonymisedText,
          llmOutput: pasted,
          restoredOutput: restored.restoredText,
          mode: 'private-local',
          timestamp: new Date().toISOString(),
        },
      });
      s.setLocalPending(null);
    } catch (e: any) {
      s.addMessage({ id: randomUUID(), role: 'system', content: `Error: ${e.message}` });
    } finally {
      s.setNerProgress(null);
      s.setBusy(false);
    }
  }

  return { sendDirect, startReview, approveReview, restorePasted, cancel };
}
