import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bot,
  User,
  Copy,
  Check,
  RotateCcw,
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronRight,
  Zap,
  Terminal,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  KeyRound,
  Clock,
  X
} from 'lucide-react';
import { ChatMessage } from '../types/chat';
import { CodeBlock } from './CodeBlock';

interface MessageItemProps {
  message: ChatMessage;
  isLastAssistant?: boolean;
  onRegenerate?: () => void;
  onSwitchToFree?: () => void;
  onConfirmToolCall?: (toolCallId: string, confirmed: boolean) => void;
  onExecuteToolCall?: (toolCallId: string) => void;
  isStreaming?: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isLastAssistant = false,
  onRegenerate,
  onSwitchToFree,
  onConfirmToolCall,
  onExecuteToolCall,
  isStreaming = false
}) => {
  const [copied, setCopied] = useState(false);
  const [isReasoningOpen, setIsReasoningOpen] = useState(false);

  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const is402 = Boolean(
    message.is402Error ||
    message.error?.includes('402') ||
    message.error?.toLowerCase().includes('credit') ||
    message.error?.toLowerCase().includes('afford') ||
    message.content?.includes('402') ||
    message.content?.toLowerCase().includes('credit')
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore
    }
  };

  const formattedTime = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

  const isReasoningActive = isStreaming && Boolean(message.reasoning && !message.content);

  const displayModelName = message.model === 'anthropic/claude-opus-5.5'
    ? 'Claude Opus 5.5'
    : message.model === 'openai/gpt-6-luna-pro'
    ? 'ChatGPT 6'
    : message.model?.split('/').pop()?.replace(':free', '') || message.model;

  return (
    <div
      className={`group w-full py-4 transition-colors ${
        isUser ? 'bg-transparent' : 'bg-slate-900/35 border-y border-slate-800/40'
      }`}
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 flex gap-3.5 sm:gap-4.5">
        {/* Avatar */}
        <div className="shrink-0 mt-0.5">
          {isUser ? (
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-semibold text-xs shadow-inner">
              <User className="w-4 h-4" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-600/20 border border-indigo-400/25 flex items-center justify-center text-indigo-300 shadow-sm">
              <Bot className="w-4 h-4 text-indigo-400" />
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 min-w-0">
          {/* Header Metadata */}
          <div className="flex items-center gap-2 mb-1.5 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">
              {isUser ? 'You' : 'Setup'}
            </span>
            {message.model && !isUser && (
              <>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-indigo-300 font-medium text-[11px] truncate max-w-[200px]">
                  {displayModelName}
                </span>
              </>
            )}
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-500 font-mono text-[11px] tabular-nums">
              {formattedTime}
            </span>
          </div>

          {/* Reasoning / Thinking Process Accordion */}
          {message.reasoning && (
            <div className="mb-3 rounded-lg border border-slate-700/60 bg-slate-900/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setIsReasoningOpen(prev => !prev)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Brain className={`w-3.5 h-3.5 text-indigo-400 ${isReasoningActive ? 'animate-pulse' : ''}`} />
                  <span>
                    {isReasoningActive ? 'Thinking step-by-step...' : 'Reasoning process'}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span>{isReasoningOpen ? 'Hide' : 'Show'}</span>
                  {isReasoningOpen ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </div>
              </button>

              {(isReasoningOpen || isReasoningActive) && (
                <div className="p-3 border-t border-slate-800/80 bg-black/20 text-xs font-mono text-slate-300 leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap">
                  {message.reasoning}
                  {isReasoningActive && (
                    <span className="inline-block w-1.5 h-3 ml-1 bg-indigo-400 animate-blink" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error Message Box */}
          {isError ? (
            <div className="p-3.5 rounded-lg bg-red-950/50 border border-red-700/60 text-red-200 text-sm flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-red-300 text-xs">OpenRouter API Error</p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(message.error || message.content);
                    }}
                    title="Copy API error"
                    className="text-[11px] text-red-400 hover:text-red-200 font-mono transition-colors"
                  >
                    Copy Error
                  </button>
                </div>
                <div className="mt-1.5 p-2 rounded bg-black/40 border border-red-900/60 font-mono text-xs text-red-200 break-words leading-relaxed select-text">
                  {message.error || message.content}
                </div>
                {/* 402 Insufficient Credits Quick Switch to Free Model */}
                {is402 && onSwitchToFree && (
                  <div className="mt-2.5 p-2.5 rounded-lg bg-indigo-950/80 border border-indigo-600/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                      <p className="text-xs font-medium text-indigo-200">
                        This model requires credits. Switch to OpenRouter Free?
                      </p>
                    </div>
                    <button
                      onClick={onSwitchToFree}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer shrink-0"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-300" />
                      Switch to OpenRouter Free
                    </button>
                  </div>
                )}

                {onRegenerate && (
                  <button
                    onClick={onRegenerate}
                    className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-red-900/60 hover:bg-red-800 border border-red-700/50 text-xs font-medium text-red-100 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Retry Request
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Rendered Content */
            <div className="prose-chat text-slate-200 break-words">
              {/* Tool Calls / Automation Execution Architecture */}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="mb-3 space-y-2.5">
                  {message.toolCalls.map((tc, idx) => {
                    let parsedArgs: Record<string, unknown> = {};
                    try {
                      parsedArgs = JSON.parse(tc.function.arguments);
                    } catch {
                      parsedArgs = { raw: tc.function.arguments };
                    }

                    const isSensitive =
                      tc.sensitivity === 'sensitive' ||
                      ['send_notification', 'post_content', 'trigger_webhook', 'delete_data'].includes(tc.function.name);
                    const state = tc.state || (isSensitive ? 'awaiting_confirmation' : 'completed');

                    return (
                      <div
                        key={tc.id || idx}
                        className={`rounded-xl border overflow-hidden text-xs transition-all ${
                          state === 'awaiting_confirmation'
                            ? 'border-amber-500/60 bg-amber-950/20 shadow-md shadow-amber-950/20'
                            : state === 'running'
                            ? 'border-cyan-500/60 bg-cyan-950/20 shadow-md shadow-cyan-950/20'
                            : state === 'failed'
                            ? 'border-rose-700/60 bg-rose-950/20'
                            : 'border-slate-700/80 bg-slate-900/60'
                        }`}
                      >
                        {/* Header Bar */}
                        <div
                          className={`px-3.5 py-2.5 border-b flex items-center justify-between gap-2.5 flex-wrap ${
                            state === 'awaiting_confirmation'
                              ? 'bg-amber-950/40 border-amber-800/40'
                              : state === 'running'
                              ? 'bg-cyan-950/40 border-cyan-800/40'
                              : state === 'failed'
                              ? 'bg-rose-950/40 border-rose-800/40'
                              : 'bg-slate-800/50 border-slate-700/50'
                          }`}
                        >
                          <div className="flex items-center gap-2 font-mono flex-wrap">
                            {isSensitive ? (
                              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                            ) : (
                              <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
                            )}
                            <span className="text-slate-200 font-semibold text-xs">
                              {tc.function.name}
                            </span>
                            {isSensitive && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                Sensitive Action
                              </span>
                            )}
                          </div>

                          {/* Lifecycle State Badge */}
                          <div className="flex items-center gap-1.5">
                            {state === 'requested' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-950 border border-sky-700/60 text-sky-300">
                                <Clock className="w-3 h-3 text-sky-400" />
                                Requested
                              </span>
                            )}
                            {state === 'awaiting_confirmation' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-950 border border-amber-700/60 text-amber-300 animate-pulse">
                                <ShieldAlert className="w-3 h-3 text-amber-400" />
                                Awaiting Confirmation
                              </span>
                            )}
                            {state === 'running' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-950 border border-cyan-700/60 text-cyan-300">
                                <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
                                Running on Server
                              </span>
                            )}
                            {state === 'completed' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950 border border-emerald-700/60 text-emerald-300">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                Completed
                              </span>
                            )}
                            {state === 'failed' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-950 border border-rose-700/60 text-rose-300">
                                <AlertCircle className="w-3 h-3 text-rose-400" />
                                Failed
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Body Content */}
                        <div className="p-3 space-y-2.5 bg-black/40">
                          {/* Parameters Block */}
                          <div>
                            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                              <span>Validated Parameters (Zod Verified):</span>
                              {tc.idempotencyKey && (
                                <span className="font-mono text-[10px] text-slate-400 lowercase flex items-center gap-1">
                                  <KeyRound className="w-3 h-3 text-slate-400" />
                                  {tc.idempotencyKey.slice(0, 16)}...
                                </span>
                              )}
                            </div>
                            <pre className="p-2.5 rounded-lg bg-black/60 border border-slate-800 text-slate-200 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(parsedArgs, null, 2)}
                            </pre>
                          </div>

                          {/* Awaiting Confirmation Security Prompt & Action Buttons */}
                          {state === 'awaiting_confirmation' && (
                            <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-700/50 space-y-2.5">
                              <div className="flex items-start gap-2">
                                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-200 leading-relaxed">
                                  This action makes external or mutating changes (e.g. notifications, publications, webhooks, or deletions).
                                  The AI model cannot execute this without your explicit authorization.
                                </p>
                              </div>
                              <div className="flex items-center gap-2 pt-1 flex-wrap">
                                <button
                                  onClick={() => onConfirmToolCall?.(tc.id, true)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  Approve & Execute
                                </button>
                                <button
                                  onClick={() => onConfirmToolCall?.(tc.id, false)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5 text-slate-400" />
                                  Reject Action
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Requested State Run Button (for safe tools if not yet executed) */}
                          {state === 'requested' && (
                            <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                              <span className="text-[11px] text-slate-400">Safe read-only action ready for execution.</span>
                              <button
                                onClick={() => onExecuteToolCall?.(tc.id)}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
                              >
                                <Terminal className="w-3 h-3" />
                                Execute Now
                              </button>
                            </div>
                          )}

                          {/* Completed Output */}
                          {state === 'completed' && tc.result !== undefined && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                                <span className="flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Execution Result:
                                </span>
                                {tc.durationMs !== undefined && (
                                  <span className="font-mono text-[10px] text-slate-400 lowercase">
                                    {tc.durationMs}ms
                                  </span>
                                )}
                              </div>
                              <pre className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-800/40 text-emerald-200 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                                {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}
                              </pre>
                            </div>
                          )}

                          {/* Failed Error Message */}
                          {state === 'failed' && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] font-semibold text-rose-400 uppercase tracking-wider">
                                <span className="flex items-center gap-1">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  Execution Status:
                                </span>
                                {onExecuteToolCall && (
                                  <button
                                    onClick={() => onExecuteToolCall(tc.id)}
                                    className="text-[10px] text-rose-400 hover:text-rose-200 font-mono underline cursor-pointer"
                                  >
                                    Retry
                                  </button>
                                )}
                              </div>
                              <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs font-mono break-words">
                                {tc.error || 'Execution was rejected or encountered a server error.'}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {isUser ? (
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
              ) : (
                <>
                  {!message.content && !message.reasoning && isStreaming ? (
                    <div className="flex items-center gap-2 py-1 text-slate-400 text-xs font-mono">
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping shrink-0" />
                      <span>Generating response...</span>
                    </div>
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '');
                          const isInline = !match && !String(children).includes('\n');
                          if (isInline) {
                            return (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }
                          return (
                            <CodeBlock
                              language={match ? match[1] : ''}
                              value={String(children).replace(/\n$/, '')}
                            />
                          );
                        }
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  )}

                  {/* Pulsing blinking cursor during active streaming */}
                  {isStreaming && (!message.reasoning || message.content) && (
                    <span className="inline-block w-2 h-4 ml-1 bg-indigo-400 align-middle animate-blink rounded-xs" />
                  )}
                </>
              )}
            </div>
          )}

          {/* Action Footer (Copy, Regenerate) */}
          {!isError && (
            <div className="mt-2 flex items-center gap-1 text-slate-500 opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                title="Copy text"
                aria-label={copied ? "Message copied" : "Copy message"}
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>

              {!isUser && isLastAssistant && onRegenerate && !isStreaming && (
                <button
                  onClick={onRegenerate}
                  title="Regenerate response"
                  aria-label="Regenerate response"
                  className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
