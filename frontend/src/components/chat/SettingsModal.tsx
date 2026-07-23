import { useEffect, useState } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useModelStore } from '../../store/modelStore';
import {
  providersStatus,
  saveProviderKey,
  deleteProviderKey,
  type ProvidersStatus,
  type ProviderId,
} from '../../utils/api';

const PROVIDERS: { id: ProviderId; label: string; placeholder: string; consoleUrl: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...', consoleUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-...', consoleUrl: 'https://platform.openai.com/api-keys' },
];

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  const { models, setModel } = useModelStore();
  const [status, setStatus] = useState<ProvidersStatus | null>(null);
  const [keys, setKeys] = useState<Record<ProviderId, string>>({ openai: '', anthropic: '' });
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [error, setError] = useState('');
  // Per-provider inline feedback after a save attempt.
  const [feedback, setFeedback] = useState<Record<ProviderId, string>>({ openai: '', anthropic: '' });
  const [justSaved, setJustSaved] = useState<ProviderId | null>(null);

  async function refresh() {
    try {
      setStatus(await providersStatus());
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function save(p: ProviderId) {
    if (!keys[p].trim()) return;
    setBusy(p); setError('');
    setFeedback((f) => ({ ...f, [p]: '' }));
    try {
      // Backend validates the key (against the chosen model) before storing.
      await saveProviderKey(p, keys[p].trim(), models[p].trim() || undefined);
      setKeys((k) => ({ ...k, [p]: '' }));
      await refresh();
      setJustSaved(p);
      setTimeout(() => setJustSaved((s) => (s === p ? null : s)), 2500);
    } catch (e: any) {
      setFeedback((f) => ({ ...f, [p]: e.message }));
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: ProviderId) {
    setBusy(p); setError('');
    try {
      await deleteProviderKey(p);
      await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col">
        <div className="p-5 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Provider settings</h2>
          <p className="text-sm text-slate-500 mt-1">
            API keys are stored in your macOS Keychain — never in app files, and never sent anywhere
            except the provider they belong to. Only anonymised text is ever sent.
          </p>
        </div>

        <div className="flex-1 p-5 flex flex-col gap-5">
          {PROVIDERS.map((p) => {
            const configured = status?.[p.id]?.configured;
            const model = status?.[p.id]?.model;
            return (
              <div key={p.id} className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium text-slate-800 text-sm">{p.label}</span>
                    {model && <span className="ml-2 text-xs text-slate-400 font-mono">{model}</span>}
                  </div>
                  {configured ? (
                    <span className="text-xs text-emerald-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Key stored
                    </span>
                  ) : (
                    <a
                      href={p.consoleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-violet-600 hover:text-violet-700 hover:underline"
                    >
                      Get a key →
                    </a>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={keys[p.id]}
                    onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') save(p.id); }}
                    placeholder={configured ? 'Replace key…' : p.placeholder}
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                  <button
                    onClick={() => save(p.id)}
                    disabled={busy === p.id || !keys[p.id].trim()}
                    className="bg-slate-700 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap"
                  >
                    {busy === p.id ? 'Validating…' : 'Save'}
                  </button>
                  {configured && (
                    <button
                      onClick={() => remove(p.id)}
                      disabled={busy === p.id}
                      className="text-red-600 border border-red-200 hover:bg-red-50 rounded-lg px-3 py-1.5 text-sm"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[11px] text-slate-500 w-12 shrink-0">Model</label>
                  <input
                    value={models[p.id]}
                    onChange={(e) => setModel(p.id, e.target.value)}
                    placeholder={model /* backend default */}
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                  {models[p.id] && (
                    <button onClick={() => setModel(p.id, '')} className="text-[11px] text-slate-400 hover:text-slate-600">
                      reset
                    </button>
                  )}
                </div>
                {justSaved === p.id && (
                  <div className="mt-2 text-xs text-emerald-600 flex items-center gap-1">✓ Key validated and saved.</div>
                )}
                {feedback[p.id] && (
                  <div className="mt-2 text-xs text-red-600">{feedback[p.id]}</div>
                )}
              </div>
            );
          })}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>

        <div className="p-5 border-t border-slate-200 flex justify-end">
          <button onClick={onClose} className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2 text-sm font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
