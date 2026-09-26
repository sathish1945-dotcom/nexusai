import React, { useState } from 'react';
import { X, Check, Search, Cpu, Sparkles, ExternalLink, ArrowRight } from 'lucide-react';
import { ModelInfo } from '../types/chat';

interface ModelSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModel: string;
  onSelectModel: (modelId: string) => void;
  curatedModels: ModelInfo[];
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  isOpen,
  onClose,
  currentModel,
  onSelectModel,
  curatedModels
}) => {
  const [search, setSearch] = useState('');
  const [customModelId, setCustomModelId] = useState('');

  if (!isOpen) return null;

  const filtered = curatedModels.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.id.toLowerCase().includes(search.toLowerCase()) ||
    m.provider.toLowerCase().includes(search.toLowerCase())
  );

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customModelId.trim()) {
      onSelectModel(customModelId.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div
        className="w-full max-w-lg rounded-2xl bg-[#121520] border border-slate-700/80 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Select AI Model</h3>
              <p className="text-xs text-slate-400">Choose from OpenRouter supported models</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-3.5 pb-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, provider, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2">
          {filtered.map((m) => {
            const isSelected = m.id === currentModel;
            return (
              <button
                key={m.id}
                onClick={() => {
                  onSelectModel(m.id);
                  onClose();
                }}
                className={`w-full p-3 rounded-xl border text-left transition-all flex items-start justify-between gap-3 ${
                  isSelected
                    ? 'bg-indigo-950/40 border-indigo-500/80 text-white'
                    : 'bg-slate-900/60 hover:bg-slate-800/80 border-slate-800 text-slate-300'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-xs text-white">{m.name}</span>
                    <span aria-hidden="true" className="text-slate-600 text-xs">·</span>
                    <span className="text-[11px] text-slate-400">{m.provider}</span>
                    {m.badge && (
                      <>
                        <span aria-hidden="true" className="text-slate-600 text-xs">·</span>
                        <span className="text-[11px] font-mono text-indigo-400 font-semibold">{m.badge}</span>
                      </>
                    )}
                    {m.isFree && (
                      <>
                        <span aria-hidden="true" className="text-slate-600 text-xs">·</span>
                        <span className="text-[11px] font-mono text-emerald-400 font-semibold">Free</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-1">{m.description}</p>
                  <p className="text-[11px] font-mono text-slate-400 mt-1 truncate">{m.id}</p>
                </div>
                {isSelected && (
                  <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-white shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Custom Model Form */}
        <div className="p-4 border-t border-slate-800 bg-[#0c0e16]">
          <form onSubmit={handleApplyCustom} className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Or use any custom OpenRouter Model ID:</span>
              <a
                href="https://openrouter.ai/models"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
              >
                Browse 200+ models <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. meta-llama/llama-3.3-70b-instruct"
                value={customModelId}
                onChange={(e) => setCustomModelId(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <button
                type="submit"
                disabled={!customModelId.trim()}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1 transition-colors"
              >
                Apply <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
