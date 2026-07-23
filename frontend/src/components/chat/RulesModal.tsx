import { useState } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useRulesStore } from '../../store/rulesStore';
import type { DetectionCategory } from '../../types';

const CATEGORIES: DetectionCategory[] = [
  'CUSTOM', 'PERSON', 'ORGANIZATION', 'ADDRESS', 'LOCATION',
  'EMAIL', 'PHONE', 'DATE', 'MONETARY', 'CREDIT_CARD', 'URL', 'TAX_ID',
];

export default function RulesModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  const { rules, addRule, updateRule, removeRule, clearRules } = useRulesStore();
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState<DetectionCategory>('CUSTOM');
  const [isRegex, setIsRegex] = useState(false);
  const [error, setError] = useState('');
  // id of the rule being edited + its working copy
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ pattern: string; category: DetectionCategory; isRegex: boolean }>({
    pattern: '', category: 'CUSTOM', isRegex: false,
  });

  function startEdit(r: { id: string; pattern: string; category: DetectionCategory; isRegex: boolean }) {
    setEditId(r.id);
    setDraft({ pattern: r.pattern, category: r.category, isRegex: r.isRegex });
    setError('');
  }
  function saveEdit() {
    const trimmed = draft.pattern.trim();
    if (!trimmed) return;
    if (draft.isRegex) {
      try { new RegExp(trimmed); } catch { setError('Invalid regular expression.'); return; }
    }
    updateRule(editId!, { pattern: trimmed, category: draft.category, isRegex: draft.isRegex });
    setEditId(null);
    setError('');
  }

  function add() {
    const trimmed = pattern.trim();
    if (!trimmed) return;
    if (isRegex) {
      try { new RegExp(trimmed); } catch { setError('Invalid regular expression.'); return; }
    }
    addRule({ pattern: trimmed, category, isRegex });
    setPattern('');
    setError('');
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col">
        <div className="p-5 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Local learning rules</h2>
          <p className="text-sm text-slate-500 mt-1">
            Saved terms and patterns are stored only in this browser and auto-applied to every message.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Add a rule */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[11px] text-slate-500 mb-1 block">
                  {isRegex ? 'Regular expression' : 'Term to always anonymise'}
                </label>
                <input
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                  placeholder={isRegex ? 'e.g. ACME-\\d{4}' : 'e.g. Project Falcon'}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
              </div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as DetectionCategory)}
                className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={add} className="bg-slate-700 hover:bg-slate-800 text-white rounded-lg px-3 py-1.5 text-sm font-medium">
                Add rule
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} className="accent-violet-600" />
              Treat as a regular expression
            </label>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>

          {/* Existing rules */}
          {rules.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-4">No rules yet. Add a term above, or save one from the review step.</div>
          ) : (
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
              {rules.map((r) => (
                editId === r.id ? (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-2 bg-violet-50">
                    <input
                      value={draft.pattern}
                      onChange={(e) => setDraft((d) => ({ ...d, pattern: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null); }}
                      autoFocus
                      className="font-mono text-xs flex-1 min-w-0 border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-400"
                    />
                    <select
                      value={draft.category}
                      onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as DetectionCategory }))}
                      className="text-[11px] border border-slate-300 rounded px-1 py-1"
                    >
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-[10px] text-slate-600" title="Regex">
                      <input type="checkbox" checked={draft.isRegex} onChange={(e) => setDraft((d) => ({ ...d, isRegex: e.target.checked }))} className="accent-violet-600" />.*
                    </label>
                    <button onClick={saveEdit} className="text-emerald-600 hover:text-emerald-700 text-sm" title="Save">💾</button>
                    <button onClick={() => setEditId(null)} className="text-slate-400 hover:text-slate-600 text-sm" title="Cancel">✕</button>
                  </div>
                ) : (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="font-mono text-xs text-slate-700 flex-1 truncate" title={r.pattern}>{r.pattern}</span>
                    {r.isRegex && <span className="text-[10px] text-violet-500 border border-violet-200 rounded px-1">regex</span>}
                    <span className="text-[10px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{r.category}</span>
                    <button onClick={() => startEdit(r)} className="text-slate-400 hover:text-violet-600 text-sm" title="Edit">✎</button>
                    <button onClick={() => removeRule(r.id)} className="text-slate-400 hover:text-red-500 text-sm" title="Delete">✕</button>
                  </div>
                )
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={clearRules}
            disabled={rules.length === 0}
            className="text-sm text-red-600 hover:text-red-700 disabled:opacity-30"
          >
            Clear all rules
          </button>
          <button onClick={onClose} className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2 text-sm font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
