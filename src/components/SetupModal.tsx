import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Terminal,
  Activity,
  Puzzle,
  FileText,
  Clock,
  KeyRound,
  Shield
} from 'lucide-react';
import { BackendConfig } from '../types/chat';
import { IntegrationManager } from './IntegrationManager';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: BackendConfig | null;
  onRefreshConfig: () => Promise<void>;
  onSelectPrompt?: (prompt: string) => void;
  initialTab?: 'integrations' | 'api' | 'audit' | 'security';
}

interface AuditLogRecord {
  id: string;
  timestamp: string;
  toolName: string;
  sensitivity: 'safe' | 'sensitive';
  idempotencyKey: string;
  parameters: Record<string, unknown>;
  status: 'completed' | 'failed' | 'awaiting_confirmation' | 'rejected';
  durationMs: number;
  result?: unknown;
  error?: string;
  clientIp?: string;
}

export const SetupModal: React.FC<SetupModalProps> = ({
  isOpen,
  onClose,
  config,
  onRefreshConfig,
  onSelectPrompt,
  initialTab = 'integrations'
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'integrations' | 'api' | 'audit' | 'security'>(initialTab);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const fetchAuditLogs = async () => {
    try {
      setLoadingLogs(true);
      const res = await fetch('/api/tools/audit-log');
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      }
    } catch (err) {
      console.warn('Failed to load audit logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'audit') {
      fetchAuditLogs();
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshConfig();
    } finally {
      setRefreshing(false);
    }
  };

  const isConfigured = config?.isKeyConfigured;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-xs">
      <div
        className="w-full max-w-2xl rounded-2xl bg-[#0f111a] border border-slate-700/80 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0b0e17]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Puzzle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>Settings</span>
                <span>→</span>
                <span className="text-indigo-300 font-medium capitalize">{activeTab}</span>
              </div>
              <h3 className="text-sm font-bold text-white tracking-tight">Setup Integrations & Settings</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close setup modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex px-6 border-b border-slate-800 bg-[#0d101b] gap-2 overflow-x-auto text-xs font-medium text-slate-400">
          <button
            onClick={() => setActiveTab('integrations')}
            className={`py-3 px-2 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'integrations'
                ? 'border-indigo-500 text-white font-semibold'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            <Puzzle className="w-3.5 h-3.5 text-indigo-400" />
            <span>Integrations (Gmail, Calendar, Drive)</span>
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`py-3 px-2 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'audit'
                ? 'border-indigo-500 text-white font-semibold'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Audit Trail</span>
          </button>
          <button
            onClick={() => setActiveTab('api')}
            className={`py-3 px-2 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'api'
                ? 'border-indigo-500 text-white font-semibold'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>OpenRouter API</span>
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`py-3 px-2 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'security'
                ? 'border-indigo-500 text-white font-semibold'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>Security Model</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs text-slate-300 leading-relaxed">
          {/* TAB 1: INTEGRATIONS */}
          {activeTab === 'integrations' && (
            <IntegrationManager
              onClose={onClose}
              onSelectPrompt={(prompt) => {
                onClose();
                onSelectPrompt?.(prompt);
              }}
            />
          )}

          {/* TAB 2: AUDIT TRAIL */}
          {activeTab === 'audit' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-1">
                <div>
                  <h4 className="text-xs font-bold text-white">Execution Audit Trail</h4>
                  <p className="text-[11px] text-slate-400">
                    Live log of all server-side connector and tool actions with parameters and status.
                  </p>
                </div>
                <button
                  onClick={fetchAuditLogs}
                  disabled={loadingLogs}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-300"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingLogs ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {auditLogs.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400 space-y-1">
                  <Activity className="w-6 h-6 mx-auto text-slate-500 opacity-60" />
                  <p className="font-medium text-xs text-slate-300">No actions executed yet</p>
                  <p className="text-[11px]">When the AI model or user triggers a tool or external integration, execution events will appear here.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs font-mono space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              log.status === 'completed'
                                ? 'bg-emerald-400'
                                : log.status === 'awaiting_confirmation'
                                ? 'bg-amber-400'
                                : 'bg-rose-400'
                            }`}
                          />
                          <span className="font-bold text-white text-xs">{log.toolName}</span>
                          <span className="text-[10px] text-slate-400">({log.sensitivity})</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          <span>{log.durationMs}ms</span>
                          <span>·</span>
                          <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>

                      <div className="p-2 rounded bg-black/50 border border-slate-800/80 text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(log.parameters, null, 2)}
                      </div>

                      {log.error && (
                        <p className="text-[11px] text-rose-400 break-words">
                          Error: {log.error}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: OPENROUTER API */}
          {activeTab === 'api' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-[#0a0d14] rounded-xl border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {isConfigured ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                  )}
                  <div>
                    <p className="text-xs font-semibold text-white">
                      {isConfigured ? 'OPENROUTER_API_KEY Configured' : 'API Key Missing on Server'}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Default Model: <code className="text-indigo-300 font-mono">{config?.defaultModel || 'anthropic/claude-opus-5.5'}</code>
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>Check Status</span>
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <p className="font-semibold text-white">OpenRouter API Key Setup</p>
                <p className="text-slate-400 text-xs">
                  Your API key is configured on the backend environment (<code className="font-mono text-indigo-300">OPENROUTER_API_KEY</code>).
                  It is never transmitted or exposed to client browsers.
                </p>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium text-xs"
                >
                  Manage API Keys at openrouter.ai/keys <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          {/* TAB 4: SECURITY MODEL */}
          {activeTab === 'security' && (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Security Invariants & Protections</span>
                </div>
                <ul className="space-y-2 text-slate-300 text-xs list-disc pl-4">
                  <li>
                    <strong className="text-white">Zero Arbitrary Execution:</strong> The AI model cannot execute arbitrary JavaScript, shell scripts, raw SQL, or arbitrary URLs.
                  </li>
                  <li>
                    <strong className="text-white">Strict Allowlist & Zod Validation:</strong> Every connector action adheres to an explicit server-side Zod schema.
                  </li>
                  <li>
                    <strong className="text-white">Encrypted Credential Vault:</strong> OAuth tokens for Gmail, Calendar, and Drive are encrypted server-side with AES-256-GCM.
                  </li>
                  <li>
                    <strong className="text-white">CSRF OAuth State:</strong> OAuth connections require server-generated cryptographic state verification.
                  </li>
                  <li>
                    <strong className="text-white">Explicit Confirmation:</strong> Any action that modifies external systems requires user confirmation before execution.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
