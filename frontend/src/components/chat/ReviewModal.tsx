import { useRef, useState } from 'react';
import { useChatStore } from '../../store/chatStore';
import { useRulesStore } from '../../store/rulesStore';
import { useChatActions } from '../../hooks/useChatActions';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { anonymisePreview, placeholderFor } from '../../utils/anonymisePreview';
import { randomUUID } from '../../utils/uuid';
import type { DetectionCategory } from '../../types';

const CATEGORY_COLORS: Record<string, string> = {
  EMAIL: 'bg-blue-100 text-blue-700',
  PHONE: 'bg-green-100 text-green-700',
  URL: 'bg-purple-100 text-purple-700',
  DATE: 'bg-orange-100 text-orange-700',
  MONETARY: 'bg-yellow-100 text-yellow-700',
  CREDIT_CARD: 'bg-red-100 text-red-700',
  IBAN: 'bg-pink-100 text-pink-700',
  IP_ADDRESS: 'bg-cyan-100 text-cyan-700',
  UUID: 'bg-indigo-100 text-indigo-700',
  REGISTRATION: 'bg-amber-100 text-amber-700',
  POSTAL_CODE: 'bg-lime-100 text-lime-700',
  PERSON: 'bg-rose-100 text-rose-700',
  ORGANIZATION: 'bg-teal-100 text-teal-700',
  ADDRESS: 'bg-lime-100 text-lime-700',
  LOCATION: 'bg-emerald-100 text-emerald-700',
  PII: 'bg-rose-100 text-rose-700',
  CUSTOM: 'bg-slate-100 text-slate-700',
};

const MANUAL_CATEGORIES: DetectionCategory[] = ['CUSTOM', 'PERSON', 'ORGANIZATION', 'ADDRESS', 'LOCATION', 'EMAIL', 'PHONE', 'DATE', 'MONETARY', 'CREDIT_CARD', 'URL', 'TAX_ID', 'REGISTRATION', 'POSTAL_CODE'];

export default function ReviewModal() {
  const { review, mode, busy, runningMappings, updateReviewEntity, addReviewEntity, removeReviewEntity, setReview } = useChatStore();
  const { approveReview } = useChatActions();
  const addRule = useRulesStore((s) => s.addRule);
  useEscapeKey(() => { if (!busy) setReview(null); });
  const originalRef = useRef<HTMLPreElement>(null);
  const [manualValue, setManualValue] = useState('');
  const [manualCategory, setManualCategory] = useState<DetectionCategory>('CUSTOM');
  const [rememberRule, setRememberRule] = useState(false);
  const [selectionHint, setSelectionHint] = useState('');

  if (!review) return null;

  const included = review.entities.filter((e) => e.include).length;
  // Live preview reflecting current toggles, edits, additions and removals.
  const livePreview = anonymisePreview(review.originalText, review.entities);

  function addEntity(value: string, category: DetectionCategory, remember = false) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (review!.entities.some((e) => e.originalValue === trimmed)) {
      setSelectionHint(`"${trimmed}" is already in the list.`);
      return;
    }
    const occurrences = review!.originalText.split(trimmed).length - 1;
    addReviewEntity({
      id: randomUUID(),
      originalValue: trimmed,
      category,
      source: 'manual',
      occurrences: Math.max(1, occurrences),
      placeholder: placeholderFor(trimmed, category, review!.entities, runningMappings),
      include: true,
    });
    if (remember) addRule({ pattern: trimmed, category, isRegex: false });
    setSelectionHint('');
  }

  function anonymiseSelection() {
    const sel = window.getSelection();
    const text = sel?.toString() ?? '';
    if (!text.trim()) {
      setSelectionHint('Select some text in the box above first.');
      return;
    }
    // Ensure the selection is inside the original-text box.
    if (originalRef.current && sel?.anchorNode && !originalRef.current.contains(sel.anchorNode)) {
      setSelectionHint('Please select text within the original message box.');
      return;
    }
    addEntity(text, 'CUSTOM');
    sel?.removeAllRanges();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="p-5 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Review before sending</h2>
          <p className="text-sm text-slate-500 mt-1">
            {mode === 'approved-external'
              ? 'Only the anonymised text below will be sent. Original data and the map stay local.'
              : 'Review what will be anonymised before you copy it out.'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {review.nerPartial && (
            <div className="border-2 border-red-300 bg-red-50 rounded-xl p-3 text-sm text-red-700">
              <strong>⚠ Name detection did not finish for this message.</strong>
              <p className="mt-1 text-red-600 text-xs">
                Only structured data (emails, phones, IBANs, amounts…) was detected automatically.
                Names, organizations, addresses and locations were <em>not</em> — review the text
                carefully and add any missed terms below before sending. This often happens with very
                long documents; you can also split them into smaller messages.
              </p>
            </div>
          )}
          {/* Original text — select to anonymise */}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">
              Original message — highlight any text, then click “Anonymise selection”
            </label>
            <pre
              ref={originalRef}
              className="border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto select-text"
            >
              {review.originalText}
            </pre>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={anonymiseSelection}
                className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg"
              >
                + Anonymise selection
              </button>
              {selectionHint && <span className="text-xs text-amber-600">{selectionHint}</span>}
            </div>
          </div>

          {/* Detected/added entities */}
          {review.entities.length === 0 ? (
            <div className="text-sm text-slate-500">No items will be anonymised. Highlight text or add a term below.</div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-y-auto max-h-72">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">On</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Original</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Category</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Placeholder</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {review.entities.map((e) => (
                    <tr key={e.id} className={e.include ? '' : 'opacity-40'}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={e.include}
                          onChange={() => updateReviewEntity(e.id, { include: !e.include })}
                          className="w-4 h-4 accent-violet-600"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700 max-w-[180px] truncate" title={e.originalValue}>
                        {e.originalValue}
                        {e.source === 'manual' && <span className="ml-1 text-[10px] text-violet-500">(added)</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[e.category] ?? CATEGORY_COLORS.CUSTOM}`}>
                          {e.category}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={e.placeholder}
                          onChange={(ev) => updateReviewEntity(e.id, { placeholder: ev.target.value })}
                          className="font-mono text-xs border border-slate-200 rounded px-2 py-1 w-28 focus:outline-none focus:ring-1 focus:ring-violet-400"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => removeReviewEntity(e.id)}
                          title="Remove from list"
                          className="text-slate-400 hover:text-red-500 text-sm"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Manual add */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 flex flex-col gap-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[11px] text-slate-500 mb-1 block">Add a term to anonymise</label>
                <input
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { addEntity(manualValue, manualCategory, rememberRule); setManualValue(''); } }}
                  placeholder="e.g. John Smith, Acme Corp"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
              </div>
              <select
                value={manualCategory}
                onChange={(e) => setManualCategory(e.target.value as DetectionCategory)}
                className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                {MANUAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                onClick={() => { addEntity(manualValue, manualCategory, rememberRule); setManualValue(''); }}
                className="bg-slate-700 hover:bg-slate-800 text-white rounded-lg px-3 py-1.5 text-sm font-medium"
              >
                Add
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={rememberRule} onChange={(e) => setRememberRule(e.target.checked)} className="accent-violet-600" />
              Remember as a rule (auto-anonymise this term in future messages)
            </label>
          </div>

          {/* Live preview */}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">
              Exactly what will {mode === 'approved-external' ? 'be sent' : 'be produced'}
            </label>
            <pre className={`border-2 rounded-xl p-3 text-xs font-mono text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto
              ${mode === 'approved-external' ? 'border-amber-300 bg-amber-50/40' : 'border-green-300 bg-green-50/40'}`}>
              {livePreview}
            </pre>
          </div>
        </div>

        <div className="p-5 border-t border-slate-200 flex items-center justify-between">
          <button onClick={() => setReview(null)} className="text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </button>
          <button
            onClick={approveReview}
            disabled={busy}
            className={`text-white rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-40
              ${mode === 'approved-external' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}
          >
            {busy ? 'Working…' : mode === 'approved-external'
              ? `Approve & send (${included})`
              : `Approve & copy (${included})`}
          </button>
        </div>
      </div>
    </div>
  );
}
