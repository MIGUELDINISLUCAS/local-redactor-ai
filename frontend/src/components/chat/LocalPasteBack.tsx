import { useState } from 'react';
import { useChatStore } from '../../store/chatStore';
import { useChatActions } from '../../hooks/useChatActions';
import { useEscapeKey } from '../../hooks/useEscapeKey';

export default function LocalPasteBack() {
  const { localPending, busy, setLocalPending } = useChatStore();
  const { restorePasted } = useChatActions();
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  useEscapeKey(() => { if (!busy) setLocalPending(null); });
  if (!localPending) return null;

  function copy() {
    navigator.clipboard.writeText(localPending!.anonymisedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="p-5 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Private Local Mode — manual copy/paste</h2>
          <p className="text-sm text-slate-500 mt-1">No cloud. No APIs. Nothing leaves your device.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-500">1. Copy this anonymised prompt</label>
              <button onClick={copy} className="text-xs bg-slate-700 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg">
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <pre className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {localPending.anonymisedText}
            </pre>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">
              2. Paste the LLM output here to restore it locally
            </label>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              placeholder="Paste the response from ChatGPT, Claude, etc…"
              className="w-full border border-slate-200 rounded-xl p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
            />
          </div>
        </div>

        <div className="p-5 border-t border-slate-200 flex items-center justify-between">
          <button onClick={() => setLocalPending(null)} className="text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </button>
          <button
            onClick={() => restorePasted(pasted)}
            disabled={busy || !pasted.trim()}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg px-5 py-2 text-sm font-medium"
          >
            {busy ? 'Restoring…' : 'Restore locally'}
          </button>
        </div>
      </div>
    </div>
  );
}
