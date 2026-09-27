import React from 'react';
import { PanelLeftOpen, PanelLeftClose, ChevronDown, Download, Trash2, HelpCircle, Puzzle } from 'lucide-react';
import { ModelInfo } from '../types/chat';

interface ChatHeaderProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  currentModel: string;
  modelsList: ModelInfo[];
  onOpenModelSelector: () => void;
  onExportChat: () => void;
  onClearChat: () => void;
  onOpenSetup: () => void;
  onOpenIntegrations?: () => void;
  isKeyConfigured: boolean;
  hasMessages: boolean;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  currentModel,
  modelsList,
  onOpenModelSelector,
  onExportChat,
  onClearChat,
  onOpenSetup,
  onOpenIntegrations,
  isKeyConfigured,
  hasMessages
}) => {
  const activeModelObj = modelsList.find(m => m.id === currentModel);
  const modelName = activeModelObj
    ? activeModelObj.name
    : currentModel === 'anthropic/claude-opus-5.5'
    ? 'Claude Opus 5.5'
    : currentModel === 'openai/gpt-6-luna-pro'
    ? 'ChatGPT 6'
    : currentModel.split('/').pop()?.replace(':free', '') || currentModel;

  return (
    <header className="h-14 border-b border-slate-800/80 bg-[#0f1117]/80 backdrop-blur-md px-4 flex items-center justify-between z-10 shrink-0">
      {/* Zone 1: Brand & Toggle */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {isSidebarOpen ? (
            <PanelLeftClose className="w-4 h-4" />
          ) : (
            <PanelLeftOpen className="w-4 h-4" />
          )}
        </button>

        <span className="text-base font-bold tracking-tight text-white select-none">
          Setup
        </span>
      </div>

      {/* Zone 2: Model Selector */}
      <div className="flex items-center">
        <button
          onClick={onOpenModelSelector}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/60 text-xs font-medium text-slate-200 hover:text-white transition-colors max-w-[240px] sm:max-w-xs"
        >
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50 shrink-0" />
          <span className="truncate">{modelName}</span>
          {activeModelObj?.isFree && (
            <span className="hidden sm:inline font-mono text-[10px] text-emerald-400 font-semibold uppercase">
              Free
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        </button>
      </div>

      {/* Zone 3: Actions */}
      <div className="flex items-center gap-1.5">
        {hasMessages && (
          <>
            <button
              onClick={onExportChat}
              aria-label="Export conversation"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
              title="Export conversation (Markdown)"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={onClearChat}
              aria-label="Clear current conversation"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800/60 transition-colors"
              title="Clear messages"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}

        <a
          href="/api/download"
          download="setup-project.zip"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/50 border border-emerald-700/60 bg-emerald-950/20 transition-all cursor-pointer"
          title="Download Complete Project Source Code (ZIP)"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Download ZIP</span>
        </a>

        <button
          onClick={onOpenIntegrations || onOpenSetup}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
          title="Settings → Integrations (Gmail, Calendar, Drive, Webhooks)"
        >
          <Puzzle className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden sm:inline">Integrations</span>
        </button>

        <button
          onClick={onOpenSetup}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            isKeyConfigured
              ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
          }`}
          title="Settings & Server Setup"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Settings</span>
        </button>
      </div>
    </header>
  );
};
