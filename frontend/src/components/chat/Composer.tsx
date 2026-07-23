import { useRef } from 'react';
import { useChatStore } from '../../store/chatStore';
import { useChatActions } from '../../hooks/useChatActions';
import { detectFromFile } from '../../utils/api';
import { randomUUID } from '../../utils/uuid';

export default function Composer() {
  const { input, setInput, attachments, addAttachment, removeAttachment, mode, busy, provider, setProvider, nerProgress, webSearch, setWebSearch } = useChatStore();
  const { sendDirect, startReview, cancel } = useChatActions();
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const res = await detectFromFile(file);
        addAttachment({
          id: randomUUID(),
          name: res.fileMetadata.filename,
          text: res.extractedText,
          warnings: res.fileMetadata.warnings,
        });
      } catch (e: any) {
        addAttachment({ id: randomUUID(), name: file.name, text: '', warnings: [e.message] });
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  const canSend = (input.trim() || attachments.length > 0) && !busy;
  const primaryLabel = mode === 'approved-external' ? 'Send to LLM' : 'Anonymise & copy';
  const reviewLabel = mode === 'approved-external' ? 'Review before sending' : 'Review';

  const pct = nerProgress && nerProgress.total > 0
    ? Math.round((nerProgress.done / nerProgress.total) * 100)
    : 0;

  return (
    <div className="border-t border-slate-200 bg-white p-4">
      {nerProgress && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
              Scanning for sensitive data with the local model…
            </span>
            <span className="flex items-center gap-3">
              <span className="tabular-nums">
                {nerProgress.total > 0 ? `chunk ${nerProgress.done}/${nerProgress.total} · ${pct}%` : 'starting…'}
              </span>
              <button onClick={cancel} className="text-red-600 hover:text-red-700 font-medium">
                Stop
              </button>
            </span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500 transition-all duration-300"
              style={{ width: `${Math.max(pct, 4)}%` }}
            />
          </div>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {attachments.map((a) => (
            <span key={a.id} className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-1.5 text-xs text-slate-600">
              📄 {a.name}
              {a.warnings.length > 0 && <span className="text-amber-500" title={a.warnings.join('; ')}>⚠</span>}
              <button onClick={() => removeAttachment(a.id)} className="text-slate-400 hover:text-red-500">✕</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 border border-slate-200 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-violet-400">
        <input ref={fileRef} type="file" multiple accept=".txt,.pdf,.docx,.md,.csv" className="hidden" onChange={(e) => onFiles(e.target.files)} />
        <button
          onClick={() => fileRef.current?.click()}
          title="Attach files"
          className="shrink-0 w-9 h-9 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 text-lg flex items-center justify-center"
        >
          +
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) sendDirect();
          }}
          rows={1}
          placeholder="Type a message…"
          className="flex-1 resize-none outline-none text-sm py-2 max-h-40"
        />
      </div>

      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-slate-400 flex items-center gap-2">
          {mode === 'approved-external' ? (
            <>
              <span>Send only anonymised text via</span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as 'mock' | 'openai' | 'anthropic')}
                className="text-xs border border-slate-200 rounded px-1.5 py-1 text-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                <option value="mock">Mock provider</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
              </select>
              {provider !== 'mock' && (
                <label
                  className="flex items-center gap-1 cursor-pointer"
                  title="Let the model search the web (with citations). Only the anonymised query is searched — original data still stays local."
                >
                  <input
                    type="checkbox"
                    checked={webSearch}
                    onChange={(e) => setWebSearch(e.target.checked)}
                    className="accent-violet-600"
                  />
                  🔎 Web search
                </label>
              )}
            </>
          ) : (
            'Nothing leaves your device. Anonymise, then copy manually.'
          )}
        </span>
        <div className="flex gap-2">
          <button
            onClick={startReview}
            disabled={!canSend}
            className="border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {reviewLabel}
          </button>
          <button
            onClick={sendDirect}
            disabled={!canSend}
            className={`text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40
              ${mode === 'approved-external' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}
          >
            {busy ? 'Working…' : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
