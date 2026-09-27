import React, { useRef, useEffect } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  input,
  setInput,
  onSubmit,
  onStop,
  isStreaming,
  disabled = false
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(el.scrollHeight, 200);
    el.style.height = `${newHeight}px`;
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && input.trim() && !disabled) {
        onSubmit();
      }
    }
  };

  return (
    <div className="w-full bg-[#0d0f17]/90 backdrop-blur-md pt-2 pb-3 border-t border-slate-800/40">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isStreaming) {
              onStop();
            } else if (input.trim() && !disabled) {
              onSubmit();
            }
          }}
          className="relative flex items-end w-full rounded-2xl bg-[#171b26] border border-slate-700/60 shadow-lg shadow-black/20 focus-within:border-indigo-500/70 focus-within:ring-1 focus-within:ring-indigo-500/40 transition-all"
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Setup... (Enter to send, Shift+Enter for newline)"
            disabled={disabled}
            className="w-full max-h-[200px] resize-none bg-transparent py-3.5 pl-4 pr-12 text-sm text-slate-100 placeholder-slate-400 focus:outline-none leading-relaxed"
          />

          <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="w-8 h-8 rounded-xl bg-slate-200 hover:bg-white text-slate-900 flex items-center justify-center transition-all shadow-sm"
                title="Stop generating"
                aria-label="Stop generating"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || disabled}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                  input.trim() && !disabled
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
                title="Send message"
                aria-label="Send message"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>

        <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-slate-400">
          <span>AI outputs can vary in precision. Verify factual claims.</span>
          {input.length > 0 && (
            <span className="font-mono tabular-nums text-slate-400">
              {input.length} chars
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
