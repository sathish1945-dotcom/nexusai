import React from 'react';
import { Sparkles, Terminal, Code2, Cpu, FileText } from 'lucide-react';
import { ModelInfo } from '../types/chat';

interface EmptyStateProps {
  currentModel: string;
  modelsList: ModelInfo[];
  onSelectPrompt: (promptText: string) => void;
  isKeyConfigured: boolean;
  onOpenSetup: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  currentModel,
  modelsList,
  onSelectPrompt,
  isKeyConfigured,
  onOpenSetup
}) => {
  const activeModelObj = modelsList.find(m => m.id === currentModel);
  const modelDisplayName = activeModelObj
    ? activeModelObj.name
    : currentModel === 'anthropic/claude-opus-5.5'
    ? 'Claude Opus 5.5'
    : currentModel === 'openai/gpt-6-luna-pro'
    ? 'ChatGPT 6'
    : currentModel.split('/').pop() || currentModel;

  const suggestions = [
    {
      icon: Terminal,
      title: 'Generate TypeScript API Proxy',
      prompt: 'Write a secure TypeScript Express proxy endpoint that relays chat messages to OpenRouter with Server-Sent Events (SSE) streaming.'
    },
    {
      icon: Cpu,
      title: 'Explain Quantization & LoRA',
      prompt: 'Explain what 4-bit model quantization and LoRA fine-tuning mean in modern LLMs in 3 concise paragraphs.'
    },
    {
      icon: Code2,
      title: 'Debug React Hydration Error',
      prompt: 'How do I identify and fix a Next.js hydration error where server-rendered HTML differs from the client render?'
    },
    {
      icon: FileText,
      title: 'Draft System Architecture Spec',
      prompt: 'Draft an architectural RFC for a multi-tenant AI workflow service detailing security invariants and latency limits.'
    }
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 max-w-2xl mx-auto w-full text-center">
      {/* Brand Icon & Welcome */}
      <div className="mb-6 flex flex-col items-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 via-slate-800 to-indigo-900/30 border border-indigo-500/30 flex items-center justify-center shadow-lg shadow-indigo-500/5 mb-4">
          <Sparkles className="w-7 h-7 text-indigo-400" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">
          How can I help you today?
        </h2>
        <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap justify-center">
          <span>Active Engine</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-indigo-300 font-medium">{modelDisplayName}</span>
          {activeModelObj?.badge && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-indigo-400 font-mono font-semibold">{activeModelObj.badge}</span>
            </>
          )}
          {activeModelObj?.isFree && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400 font-mono">Free Tier</span>
            </>
          )}
        </div>
      </div>

      {/* API Key Status Notice */}
      {!isKeyConfigured && (
        <div className="w-full mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 text-left flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-amber-200">Server API Key Needed</p>
            <p className="text-xs text-amber-300/80 mt-0.5">
              Add your <code className="font-mono bg-amber-950/40 px-1 py-0.5 rounded text-amber-100">OPENROUTER_API_KEY</code> to server environment variables to stream live responses.
            </p>
          </div>
          <button
            onClick={onOpenSetup}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-semibold text-amber-200 transition-colors whitespace-nowrap shrink-0"
          >
            Setup Guide
          </button>
        </div>
      )}

      {/* Prompt Suggestions Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
        {suggestions.map((item, idx) => {
          const Icon = item.icon;
          return (
            <button
              key={idx}
              onClick={() => onSelectPrompt(item.prompt)}
              className="group p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700/80 transition-all text-left flex flex-col justify-between"
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-4 h-4 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
                <span className="text-xs font-semibold text-slate-200 group-hover:text-white">
                  {item.title}
                </span>
              </div>
              <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                {item.prompt}
              </p>
            </button>
          );
        })}
      </div>
      <footer className="mt-8 flex justify-center gap-4 text-xs text-slate-400">
        <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
        <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
      </footer>
    </div>
  );
};
