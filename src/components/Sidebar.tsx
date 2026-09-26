import React, { useState, useMemo, useRef } from 'react';
import {
  Plus,
  MessageSquare,
  Search,
  Trash2,
  Edit2,
  Check,
  X,
  Pin,
  Sparkles,
  Server,
  Puzzle,
  ChevronRight
} from 'lucide-react';
import { Conversation } from '../types/chat';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  onPinConversation: (id: string) => void;
  onClearAll: () => void;
  isKeyConfigured: boolean;
  onOpenSetup: () => void;
  onOpenIntegrations?: () => void;
  defaultModel: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  conversations,
  activeId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onRenameConversation,
  onPinConversation,
  onClearAll,
  isKeyConfigured,
  onOpenSetup,
  onOpenIntegrations,
  defaultModel
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const cleanQuery = searchQuery.trim().toLowerCase();

  // Filter conversations by title
  const filteredConversations = useMemo(() => {
    if (!cleanQuery) return conversations;
    return conversations.filter(c =>
      (c.title || 'New conversation').toLowerCase().includes(cleanQuery)
    );
  }, [conversations, cleanQuery]);

  // Group filtered conversations by relative time
  const groupedConversations = useMemo(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    const pinned: Conversation[] = [];
    const today: Conversation[] = [];
    const yesterday: Conversation[] = [];
    const last7Days: Conversation[] = [];
    const older: Conversation[] = [];

    for (const c of filteredConversations) {
      if (c.pinned) {
        pinned.push(c);
        continue;
      }
      const age = now - (c.updatedAt || c.createdAt);
      if (age < oneDay) {
        today.push(c);
      } else if (age < oneDay * 2) {
        yesterday.push(c);
      } else if (age < oneDay * 7) {
        last7Days.push(c);
      } else {
        older.push(c);
      }
    }

    return [
      { label: 'Pinned', items: pinned },
      { label: 'Today', items: today },
      { label: 'Yesterday', items: yesterday },
      { label: 'Previous 7 Days', items: last7Days },
      { label: 'Older', items: older }
    ].filter(group => group.items.length > 0);
  }, [filteredConversations]);

  const handleStartRename = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const handleSaveRename = (id: string) => {
    if (editTitle.trim()) {
      onRenameConversation(id, editTitle.trim());
    }
    setEditingId(null);
  };

  // Helper to highlight matching text in title
  const renderHighlightedTitle = (title: string) => {
    const displayTitle = title || 'New conversation';
    if (!cleanQuery) return displayTitle;

    const lower = displayTitle.toLowerCase();
    const matchIndex = lower.indexOf(cleanQuery);
    if (matchIndex === -1) return displayTitle;

    const before = displayTitle.slice(0, matchIndex);
    const match = displayTitle.slice(matchIndex, matchIndex + cleanQuery.length);
    const after = displayTitle.slice(matchIndex + cleanQuery.length);

    return (
      <>
        <span>{before}</span>
        <span className="text-indigo-400 bg-indigo-500/20 px-0.5 rounded font-semibold underline decoration-indigo-400/50">
          {match}
        </span>
        <span>{after}</span>
      </>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 lg:hidden"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-40 w-72 bg-[#0a0c13] border-r border-slate-800/80 flex flex-col transition-transform duration-200 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:-translate-x-full lg:w-0 lg:border-none'
        } ${!isOpen && 'pointer-events-none'}`}
      >
        {/* Top Header & New Chat */}
        <div className="p-3 border-b border-slate-800/80 shrink-0">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="font-bold text-sm text-white tracking-tight">NexusAI</span>
            </div>
            <button
              onClick={onClose}
              className="lg:hidden p-1 text-slate-400 hover:text-white"
              aria-label="Close sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => {
              onNewChat();
              if (window.innerWidth < 1024) onClose();
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Chat</span>
          </button>

          {/* Local Search input */}
          {conversations.length > 0 && (
            <div className="relative mt-2.5">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search chats by title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchQuery('');
                }}
                className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-500/60 focus:bg-slate-900"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-white rounded"
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Search Result Counter */}
          {cleanQuery && conversations.length > 0 && (
            <div className="flex items-center justify-between px-1 mt-2 text-[11px] text-slate-400">
              <span>
                {filteredConversations.length} {filteredConversations.length === 1 ? 'result' : 'results'} found
              </span>
              <button
                onClick={() => setSearchQuery('')}
                className="text-indigo-400 hover:text-indigo-300 font-medium"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {conversations.length === 0 ? (
            <div className="text-center py-8 px-4 text-xs text-slate-400">
              No chat history yet.
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="text-center py-8 px-4 space-y-2">
              <Search className="w-6 h-6 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                No chats matching &quot;<span className="text-slate-300 font-medium">{searchQuery}</span>&quot;
              </p>
              <button
                onClick={() => setSearchQuery('')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-indigo-300 transition-colors"
              >
                Clear Search
              </button>
            </div>
          ) : (
            groupedConversations.map(group => (
              <div key={group.label}>
                <div className="px-2 mb-1.5 text-[11px] font-semibold text-slate-400 tracking-wider">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map(conv => {
                    const isActive = conv.id === activeId;
                    const isEditing = conv.id === editingId;

                    return (
                      <div
                        key={conv.id}
                        onClick={() => {
                          onSelectConversation(conv.id);
                          if (window.innerWidth < 1024) onClose();
                        }}
                        className={`group relative flex items-center justify-between px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                          isActive
                            ? 'bg-slate-800/90 text-white font-medium'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {conv.pinned ? (
                            <Pin className="w-3.5 h-3.5 text-indigo-400 shrink-0 rotate-45" />
                          ) : (
                            <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}

                          {isEditing ? (
                            <input
                              type="text"
                              value={editTitle}
                              autoFocus
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(conv.id);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full bg-slate-950 px-1.5 py-0.5 rounded border border-indigo-500 text-xs text-white focus:outline-none"
                            />
                          ) : (
                            <span className="truncate">
                              {renderHighlightedTitle(conv.title)}
                            </span>
                          )}
                        </div>

                        {/* Conversation Actions */}
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSaveRename(conv.id);
                                }}
                                className="p-1 hover:text-emerald-400 text-slate-400"
                                title="Save title"
                                aria-label="Save title"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingId(null);
                                }}
                                className="p-1 hover:text-slate-200 text-slate-400"
                                title="Cancel"
                                aria-label="Cancel"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </>
                          ) : (
                            <div className="hidden group-hover:flex items-center gap-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPinConversation(conv.id);
                                }}
                                className={`p-1 rounded hover:bg-slate-700/50 ${
                                  conv.pinned ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-200'
                                }`}
                                title={conv.pinned ? 'Unpin' : 'Pin to top'}
                                aria-label={conv.pinned ? 'Unpin' : 'Pin to top'}
                              >
                                <Pin className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => handleStartRename(e, conv)}
                                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                                title="Rename"
                                aria-label="Rename conversation"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteConversation(conv.id);
                                }}
                                className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-700/50"
                                title="Delete"
                                aria-label="Delete conversation"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-slate-800/80 bg-[#07090e] shrink-0 space-y-2">
          {/* Integrations button */}
          <button
            onClick={onOpenIntegrations || onOpenSetup}
            className="w-full flex items-center justify-between p-2 rounded-lg bg-indigo-950/40 hover:bg-indigo-900/50 border border-indigo-800/50 text-left transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Puzzle className="w-3.5 h-3.5 text-indigo-400 shrink-0 group-hover:scale-110 transition-transform" />
              <div className="truncate">
                <p className="text-[11px] font-semibold text-white truncate">
                  Settings → Integrations
                </p>
                <p className="text-[10px] text-indigo-300/80 truncate">
                  Gmail, Calendar, Drive, Webhooks
                </p>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-indigo-400/80 shrink-0" />
          </button>

          {/* Server status pill */}
          <button
            onClick={onOpenSetup}
            className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Server className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <div className="truncate">
                <p className="text-[11px] font-semibold text-slate-200 truncate">
                  {isKeyConfigured ? 'OpenRouter Connected' : 'Setup API Key'}
                </p>
                <p className="text-[10px] text-slate-400 truncate font-mono">
                  {defaultModel === 'anthropic/claude-opus-5.5'
                    ? 'Claude Opus 5.5'
                    : defaultModel === 'openai/gpt-6-luna-pro'
                    ? 'ChatGPT 6'
                    : defaultModel.split('/').pop()?.replace(':free', '') || defaultModel}
                </p>
              </div>
            </div>
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${
                isKeyConfigured ? 'bg-emerald-500 shadow-xs shadow-emerald-500/50' : 'bg-amber-400 animate-pulse'
              }`}
            />
          </button>

          {conversations.length > 0 && (
            <div className="flex items-center justify-between px-1 pt-1 text-[11px] text-slate-400">
              <span>{conversations.length} {conversations.length === 1 ? 'chat' : 'chats'}</span>
              <button
                onClick={onClearAll}
                className="hover:text-red-400 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
