import { useEffect, useRef } from 'react';
import { useChatStore } from '../../store/chatStore';

export default function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const mode = useChatStore((s) => s.mode);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-3">
        <div className="text-4xl">🛡️</div>
        <h2 className="text-xl font-semibold text-slate-700">Local Redactor AI</h2>
        <p className="text-sm text-slate-500 max-w-md">
          Type a message or attach files. Sensitive data is anonymised locally before anything is
          {mode === 'approved-external' ? ' sent.' : ' shown for copy/paste.'}
        </p>
        <p className="text-xs text-slate-400 max-w-md">
          Original data never leaves your device. The re-identification map stays local.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-4">
      {messages.map((m) => {
        if (m.role === 'system') {
          return (
            <div key={m.id} className="self-center text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">
              {m.content}
            </div>
          );
        }
        const isUser = m.role === 'user';
        return (
          <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap
              ${isUser ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
              {m.content}
              {isUser && m.anonymisedCount !== undefined && (
                <div className="mt-2 text-[11px] text-violet-200 flex items-center gap-1">
                  🔒 {m.anonymisedCount} item{m.anonymisedCount === 1 ? '' : 's'} anonymised before sending
                </div>
              )}
              {!isUser && m.warningCount !== undefined && m.warningCount > 0 && (
                <div className="mt-2 text-[11px] text-amber-600 flex items-center gap-1">
                  ⚠ {m.warningCount} restoration warning{m.warningCount === 1 ? '' : 's'}
                </div>
              )}
              {!isUser && (
                <div className="mt-2 text-[11px] text-slate-400">↩ restored locally</div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
