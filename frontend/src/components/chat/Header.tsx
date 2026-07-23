import { useChatStore } from '../../store/chatStore';
import { exportSession, sessionHasRecords } from '../../utils/sessionExport';
import type { AppMode } from '../../types';

export default function Header({ onOpenRules, onOpenSettings }: { onOpenRules: () => void; onOpenSettings: () => void }) {
  const { mode, setMode, clearSession, runningMappings, nerAvailable, messages } = useChatStore();
  const hasRecords = sessionHasRecords(messages);

  return (
    <header className="border-b border-slate-200 bg-white px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-lg">🛡️</span>
        <span className="font-semibold text-slate-800">Local Redactor AI</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          <ModeButton current={mode} value="private-local" label="Private Local" onClick={setMode} activeClass="bg-green-600" />
          <ModeButton current={mode} value="approved-external" label="Approved External" onClick={setMode} activeClass="bg-amber-600" />
        </div>
        {nerAvailable !== null && (
          <span
            className={`text-xs flex items-center gap-1 ${nerAvailable ? 'text-emerald-600' : 'text-slate-400'}`}
            title={nerAvailable
              ? 'Local NER active: names, organizations, addresses and locations are detected via your local model.'
              : 'Local NER offline: only structured data (emails, phones, IBANs, etc.) is detected. Start Ollama to enable name detection.'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${nerAvailable ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            NER {nerAvailable ? 'on' : 'off'}
          </span>
        )}
        {runningMappings.length > 0 && (
          <span className="text-xs text-slate-400">{runningMappings.length} mapping{runningMappings.length === 1 ? '' : 's'} (local)</span>
        )}
        <button
          onClick={() => exportSession(messages)}
          disabled={!hasRecords}
          title="Download a .docx audit record of every exchange this session: original input, anonymised prompt sent, LLM response, and restored output."
          className="text-xs text-violet-600 border border-violet-200 hover:bg-violet-50 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg px-3 py-1.5"
        >
          Export session
        </button>
        <button onClick={onOpenRules} className="text-xs text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-1.5">
          Rules
        </button>
        <button onClick={onOpenSettings} className="text-xs text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-1.5">
          Settings
        </button>
        <button onClick={clearSession} className="text-xs text-red-600 border border-red-200 hover:bg-red-50 rounded-lg px-3 py-1.5">
          Clear session
        </button>
      </div>
    </header>
  );
}

function ModeButton({
  current, value, label, onClick, activeClass,
}: { current: AppMode; value: AppMode; label: string; onClick: (m: AppMode) => void; activeClass: string }) {
  const active = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      className={`px-3 py-1.5 font-medium transition-colors ${active ? `${activeClass} text-white` : 'text-slate-500 hover:bg-slate-50'}`}
    >
      {label}
    </button>
  );
}
