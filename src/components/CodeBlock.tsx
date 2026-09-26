import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  language?: string;
  value: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language = 'text', value }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="relative my-3 rounded-lg overflow-hidden border border-slate-700/60 bg-[#161a23]">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#1b202c] border-b border-slate-700/50 text-xs font-mono text-slate-400">
        <span className="font-medium text-slate-300 lowercase">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          type="button"
          aria-label={copied ? "Code copied" : "Copy code"}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-sans">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span className="font-sans">Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3.5 overflow-x-auto text-sm font-mono leading-relaxed text-slate-200">
        <pre className="!bg-transparent !p-0 !m-0">
          <code>{value}</code>
        </pre>
      </div>
    </div>
  );
};
