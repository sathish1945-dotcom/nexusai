import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatHeader } from './components/ChatHeader';
import { MessageItem } from './components/MessageItem';
import { ChatInput } from './components/ChatInput';
import { EmptyState } from './components/EmptyState';
import { SetupModal } from './components/SetupModal';
import { ModelSelectorModal } from './components/ModelSelectorModal';
import { Conversation, ChatMessage, BackendConfig, ModelInfo, ToolCall } from './types/chat';
import { getBackendConfig, streamChatCompletion, executeToolApi, AutomationTool, getSessionToken, createGuestSession } from './services/api';

const AUTOMATION_TOOLS: AutomationTool[] = [
  {
    type: 'function',
    function: {
      name: 'check_system_status',
      description: 'Inspect service health, response latency, and operational telemetry for infrastructure components.',
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            enum: ['api_gateway', 'database_cluster', 'redis_cache', 'task_queue', 'auth_service', 'storage_bucket'],
            description: 'Target infrastructure service to inspect'
          },
          detail_level: {
            type: 'string',
            enum: ['basic', 'full'],
            description: 'Level of telemetry detail to query'
          }
        },
        required: ['service']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate_metric',
      description: 'Safely evaluate statistical, analytical, or performance metrics without arbitrary code execution.',
      parameters: {
        type: 'object',
        properties: {
          metric_type: {
            type: 'string',
            enum: ['average', 'growth_rate', 'conversion_rate', 'percentile_95', 'throughput', 'error_rate'],
            description: 'Statistical or mathematical operation'
          },
          values: {
            type: 'array',
            items: { type: 'number' },
            description: 'Array of numerical values to evaluate'
          },
          unit: {
            type: 'string',
            description: 'Unit of measurement (e.g. %, ms, req/s)'
          }
        },
        required: ['metric_type', 'values']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_summary_report',
      description: 'Compile operational or system analytics into a formatted structured summary.',
      parameters: {
        type: 'object',
        properties: {
          report_type: {
            type: 'string',
            enum: ['incident_postmortem', 'performance_digest', 'audit_summary', 'daily_standup'],
            description: 'Standard report template'
          },
          title: {
            type: 'string',
            description: 'Headline title for the report'
          },
          key_metrics: {
            type: 'object',
            description: 'Key-value mapping of high level metrics to include'
          }
        },
        required: ['report_type', 'title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_notification',
      description: 'Dispatch an external notification or broadcast to team communication channels (REQUIRES USER CONFIRMATION).',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            enum: ['slack_alerts', 'pagerduty', 'security_team', 'ops_discord', 'executive_digest'],
            description: 'Target communication channel'
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'Urgency tier'
          },
          message: {
            type: 'string',
            description: 'Notification body message'
          }
        },
        required: ['channel', 'priority', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'post_content',
      description: 'Publish an announcement, status post, or documentation update to portals (REQUIRES USER CONFIRMATION).',
      parameters: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            enum: ['company_status_page', 'internal_wiki', 'developer_portal'],
            description: 'Target publishing platform'
          },
          title: {
            type: 'string',
            description: 'Post title'
          },
          body: {
            type: 'string',
            description: 'Full text or markdown content of the post'
          }
        },
        required: ['platform', 'title', 'body']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'trigger_webhook',
      description: 'Trigger an authorized, pre-registered automation or pipeline webhook (REQUIRES USER CONFIRMATION). Arbitrary URLs are strictly prohibited.',
      parameters: {
        type: 'object',
        properties: {
          webhook_id: {
            type: 'string',
            enum: ['deploy_staging', 'restart_worker_pool', 'sync_customer_records', 'flush_cdn_cache', 'rotate_session_tokens'],
            description: 'Pre-registered webhook identifier'
          },
          environment: {
            type: 'string',
            enum: ['staging', 'production'],
            description: 'Target execution tier'
          },
          reason: {
            type: 'string',
            description: 'Mandatory justification for triggering this webhook'
          }
        },
        required: ['webhook_id', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_data',
      description: 'Purge temporary cache, logs, or staging test artifacts (REQUIRES USER CONFIRMATION).',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['temporary_cache', 'staging_artifacts', 'test_run_logs', 'expired_session_records'],
            description: 'Target data category to purge'
          },
          retention_days: {
            type: 'number',
            description: 'Age in days of items to purge (e.g. 0 for all staging artifacts, 7 for logs older than 7 days)'
          },
          reason: {
            type: 'string',
            description: 'Mandatory justification for this purge'
          }
        },
        required: ['target', 'retention_days', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'gmail_get_unread_count',
      description: 'Get the user current unread emails count in Gmail directly from inbox telemetry. Only returns count by default.',
      parameters: {
        type: 'object',
        properties: {
          include_previews: {
            type: 'boolean',
            description: 'Whether to fetch recent message subject previews (default false for maximum speed)'
          },
          max_previews: {
            type: 'number',
            description: 'Maximum previews to fetch if include_previews is true (default 5)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'gmail_search_messages',
      description: 'Search user emails in Gmail matching a search query (supports standard Gmail search operators like from:, subject:, has:attachment).',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query string (e.g. "invoice", "from:manager@company.com", "subject:meeting")'
          },
          max_results: {
            type: 'number',
            description: 'Maximum results to return (default 5, max 20)'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'gmail_read_message',
      description: 'Read the full details, headers, subject, and content body of a specific Gmail email by ID.',
      parameters: {
        type: 'object',
        properties: {
          message_id: {
            type: 'string',
            description: 'The unique Gmail message ID'
          }
        },
        required: ['message_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calendar_list_events',
      description: 'Retrieve upcoming events, appointments, and meetings from the user Google Calendar.',
      parameters: {
        type: 'object',
        properties: {
          time_min: {
            type: 'string',
            description: 'ISO datetime string for minimum start time (default current time)'
          },
          max_results: {
            type: 'number',
            description: 'Maximum events to return (default 10)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calendar_create_event',
      description: 'Schedule a new calendar event on Google Calendar (REQUIRES USER CONFIRMATION).',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Title or summary of the event'
          },
          start_time: {
            type: 'string',
            description: 'Start time in ISO format (e.g. 2026-09-25T14:00:00Z)'
          },
          end_time: {
            type: 'string',
            description: 'End time in ISO format (e.g. 2026-09-25T15:00:00Z)'
          },
          description: {
            type: 'string',
            description: 'Details or agenda of the meeting'
          },
          location: {
            type: 'string',
            description: 'Physical address or virtual meeting link'
          }
        },
        required: ['summary', 'start_time', 'end_time']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'drive_search_files',
      description: 'Search files and documents stored in user Google Drive.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'File name keyword or search phrase'
          },
          page_size: {
            type: 'number',
            description: 'Maximum files to return (default 10)'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'drive_read_file',
      description: 'Read the textual content or metadata of a file stored in Google Drive by file ID.',
      parameters: {
        type: 'object',
        properties: {
          file_id: {
            type: 'string',
            description: 'Google Drive file ID'
          }
        },
        required: ['file_id']
      }
    }
  }
];
import {
  loadStoredConversations,
  saveStoredConversations,
  loadStoredActiveId,
  saveStoredActiveId,
  exportConversationToMarkdown
} from './utils/storage';

export default function App() {
  // Server Config State
  const [backendConfig, setBackendConfig] = useState<BackendConfig | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('anthropic/claude-opus-5.5');

  // Chat State
  const [conversations, setConversations] = useState<Conversation[]>(() => loadStoredConversations());
  const [activeId, setActiveId] = useState<string | null>(() => loadStoredActiveId());
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // UI Modals & Drawers
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSetupOpen, setIsSetupOpen] = useState(() => /[?&](integration_connected|oauth_error)=/.test(window.location.search));
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch server configuration on mount
  const refreshConfig = async () => {
    try {
      if (!getSessionToken()) {
        await createGuestSession().catch(() => {});
      }
      const cfg = await getBackendConfig();
      setBackendConfig(cfg);
      if (cfg.defaultModel && !activeId) {
        setSelectedModel(cfg.defaultModel);
      }
    } catch (err) {
      console.error('Failed to fetch backend configuration:', err);
    }
  };

  useEffect(() => {
    refreshConfig();
  }, []);

  // Save conversations to localStorage on change
  useEffect(() => {
    saveStoredConversations(conversations);
  }, [conversations]);

  // Save activeId to localStorage on change
  useEffect(() => {
    if (activeId) {
      saveStoredActiveId(activeId);
    }
  }, [activeId]);

  // Auto-scroll to bottom of messages
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Find active conversation
  const activeConversation = conversations.find(c => c.id === activeId);
  const currentMessages = activeConversation?.messages || [];

  // Sync selected model with active conversation
  useEffect(() => {
    if (activeConversation?.model) {
      setSelectedModel(activeConversation.model);
    }
  }, [activeId, activeConversation?.model]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom('auto');
  }, [currentMessages.length, isStreaming]);

  // Create a new conversation
  const createNewChat = (initialModel?: string): string => {
    const modelToUse = initialModel || selectedModel || backendConfig?.defaultModel || 'anthropic/claude-opus-5.5';
    const newConv: Conversation = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: modelToUse,
      messages: []
    };

    setConversations(prev => [newConv, ...prev]);
    setActiveId(newConv.id);
    return newConv.id;
  };

  // Send message handler
  const handleSendMessage = async (textToSend?: string, overrideModel?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isStreaming) return;

    const currentModelId = overrideModel || selectedModel;
    setInput('');

    // Ensure we have an active conversation
    let currentConvId = activeId;
    let targetConv = conversations.find(c => c.id === currentConvId);

    if (!targetConv || !currentConvId) {
      currentConvId = createNewChat();
      targetConv = {
        id: currentConvId,
        title: text.slice(0, 40),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: currentModelId,
        messages: []
      };
    }

    const userMessage: ChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: Date.now(),
      status: 'complete'
    };

    const assistantMsgId = `msg_a_${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      reasoning: '',
      createdAt: Date.now(),
      model: currentModelId,
      status: 'streaming'
    };

    // Update conversation title if this is the first message
    const shouldUpdateTitle = targetConv.messages.length === 0;
    const newTitle = shouldUpdateTitle ? (text.length > 36 ? `${text.slice(0, 36)}...` : text) : targetConv.title;

    // Append user & blank streaming assistant message
    setConversations(prev =>
      prev.map(c => {
        if (c.id === currentConvId) {
          return {
            ...c,
            title: newTitle,
            model: currentModelId,
            updatedAt: Date.now(),
            messages: [...c.messages, userMessage, assistantMessage]
          };
        }
        return c;
      })
    );

    // Setup abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsStreaming(true);

    const historyPayload = [
      ...targetConv.messages.map(m => ({
        role: (m.role === 'tool' ? 'user' : m.role) as 'user' | 'assistant' | 'system',
        content: m.content
      })),
      { role: 'user' as const, content: text }
    ];

    let accumulatedContent = '';
    let accumulatedReasoning = '';
    let accumulatedToolCalls: ToolCall[] = [];

    try {
      await streamChatCompletion({
        model: currentModelId,
        messages: historyPayload,
        tools: AUTOMATION_TOOLS,
        tool_choice: 'auto',
        onReasoningDelta: (reasoningChunk) => {
          accumulatedReasoning += reasoningChunk;
          setConversations(prev =>
            prev.map(c => {
              if (c.id === currentConvId) {
                return {
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map(m =>
                    m.id === assistantMsgId
                      ? { ...m, reasoning: accumulatedReasoning }
                      : m
                  )
                };
              }
              return c;
            })
          );
        },
        onDelta: (chunk) => {
          accumulatedContent += chunk;
          setConversations(prev =>
            prev.map(c => {
              if (c.id === currentConvId) {
                return {
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map(m =>
                    m.id === assistantMsgId
                      ? { ...m, content: accumulatedContent, reasoning: accumulatedReasoning || m.reasoning }
                      : m
                  )
                };
              }
              return c;
            })
          );
        },
        onToolCalls: (toolCalls) => {
          accumulatedToolCalls = toolCalls;
          setConversations(prev =>
            prev.map(c => {
              if (c.id === currentConvId) {
                return {
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map(m =>
                    m.id === assistantMsgId
                      ? { ...m, toolCalls: accumulatedToolCalls }
                      : m
                  )
                };
              }
              return c;
            })
          );
        },
        signal: controller.signal
      });

      // Process tool calls into secure lifecycle states
      const processedToolCalls: ToolCall[] = accumulatedToolCalls.map((tc) => {
        const isSensitive = [
          'send_notification',
          'post_content',
          'trigger_webhook',
          'delete_data',
          'calendar_create_event',
          'webhook_trigger'
        ].includes(tc.function.name);
        return {
          ...tc,
          sensitivity: isSensitive ? ('sensitive' as const) : ('safe' as const),
          state: isSensitive ? ('awaiting_confirmation' as const) : ('requested' as const),
          idempotencyKey: tc.idempotencyKey || `idemp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        };
      });

      // Mark complete or error if empty
      const isBlankResponse = !accumulatedContent.trim() && !accumulatedReasoning.trim() && processedToolCalls.length === 0;
      const emptyErrorMsg = 'The model completed the request without generating any text. Please try again or switch models.';

      setConversations(prev =>
        prev.map(c => {
          if (c.id === currentConvId) {
            return {
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map(m =>
                m.id === assistantMsgId
                  ? isBlankResponse
                    ? {
                        ...m,
                        status: 'error',
                        error: emptyErrorMsg,
                        content: emptyErrorMsg
                      }
                    : {
                        ...m,
                        status: 'complete',
                        content: accumulatedContent,
                        reasoning: accumulatedReasoning || m.reasoning,
                        toolCalls: processedToolCalls.length > 0 ? processedToolCalls : m.toolCalls
                      }
                  : m
              )
            };
          }
          return c;
        })
      );

      // Automatically execute safe read-only tools on the server
      if (currentConvId) {
        for (const tc of processedToolCalls) {
          if (tc.sensitivity === 'safe') {
            executeSafeTool(currentConvId, assistantMsgId, tc);
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        // User stopped generation manually
        setConversations(prev =>
          prev.map(c => {
            if (c.id === currentConvId) {
              return {
                ...c,
                messages: c.messages.map(m =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        status: 'complete',
                        content: accumulatedContent || 'Generation stopped.'
                      }
                    : m
                )
              };
            }
            return c;
          })
        );
      } else {
        const errorMsg = (err as Error)?.message || 'Failed to complete chat response.';
        const is402 =
          (err as any)?.status === 402 ||
          (err as any)?.is402 === true ||
          errorMsg.includes('402') ||
          errorMsg.toLowerCase().includes('credit') ||
          errorMsg.toLowerCase().includes('afford');

        setConversations(prev =>
          prev.map(c => {
            if (c.id === currentConvId) {
              return {
                ...c,
                messages: c.messages.map(m =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        status: 'error',
                        error: errorMsg,
                        is402Error: is402,
                        content: accumulatedContent
                          ? `${accumulatedContent}\n\n⚠️ Error: ${errorMsg}`
                          : errorMsg
                      }
                    : m
                )
              };
            }
            return c;
          })
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // Execute safe read-only tool on the server
  const executeSafeTool = async (convId: string, msgId: string, toolCall: ToolCall) => {
    // Transition to running state
    setConversations(prev =>
      prev.map(c =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map(m =>
                m.id === msgId && m.toolCalls
                  ? {
                      ...m,
                      toolCalls: m.toolCalls.map(tc =>
                        tc.id === toolCall.id ? { ...tc, state: 'running' } : tc
                      )
                    }
                  : m
              )
            }
          : c
      )
    );

    try {
      const res = await executeToolApi({
        toolName: toolCall.function.name,
        arguments: toolCall.function.arguments,
        confirmed: true,
        idempotencyKey: toolCall.idempotencyKey
      });

      setConversations(prev =>
        prev.map(c =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === msgId && m.toolCalls
                    ? {
                        ...m,
                        toolCalls: m.toolCalls.map(tc =>
                          tc.id === toolCall.id
                            ? {
                                ...tc,
                                state: res.state,
                                result: res.result,
                                error: res.error,
                                durationMs: res.durationMs
                              }
                            : tc
                        )
                      }
                    : m
                )
              }
            : c
        )
      );

      // Return real integration result back to model to display final answer
      if (res.state === 'completed' && res.result !== undefined) {
        setTimeout(() => {
          feedToolResultBackToModel(convId, toolCall, res.result);
        }, 150);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Execution error';
      setConversations(prev =>
        prev.map(c =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === msgId && m.toolCalls
                    ? {
                        ...m,
                        toolCalls: m.toolCalls.map(tc =>
                          tc.id === toolCall.id
                            ? { ...tc, state: 'failed', error: errorMsg }
                            : tc
                        )
                      }
                    : m
                )
              }
            : c
        )
      );
    }
  };

  // Explicit User Authorization for Sensitive Actions (Approve or Reject)
  const handleConfirmToolCall = async (toolCallId: string, confirmed: boolean) => {
    if (!activeId) return;

    const targetConv = conversations.find(c => c.id === activeId);
    if (!targetConv) return;

    const targetMsg = targetConv.messages.find(m =>
      m.toolCalls?.some(tc => tc.id === toolCallId)
    );
    if (!targetMsg || !targetMsg.toolCalls) return;

    const targetTool = targetMsg.toolCalls.find(tc => tc.id === toolCallId);
    if (!targetTool) return;

    if (!confirmed) {
      // User declined execution: mark as failed / cancelled
      setConversations(prev =>
        prev.map(c =>
          c.id === activeId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === targetMsg.id && m.toolCalls
                    ? {
                        ...m,
                        toolCalls: m.toolCalls.map(tc =>
                          tc.id === toolCallId
                            ? {
                                ...tc,
                                state: 'failed',
                                error: 'Action cancelled by user: Authorization was explicitly declined.'
                              }
                            : tc
                        )
                      }
                    : m
                )
              }
            : c
        )
      );
      return;
    }

    // User confirmed: transition to running and execute on server
    setConversations(prev =>
      prev.map(c =>
        c.id === activeId
          ? {
              ...c,
              messages: c.messages.map(m =>
                m.id === targetMsg.id && m.toolCalls
                  ? {
                      ...m,
                      toolCalls: m.toolCalls.map(tc =>
                        tc.id === toolCallId ? { ...tc, state: 'running' } : tc
                      )
                    }
                  : m
              )
            }
          : c
      )
    );

    try {
      const res = await executeToolApi({
        toolName: targetTool.function.name,
        arguments: targetTool.function.arguments,
        confirmed: true,
        idempotencyKey: targetTool.idempotencyKey
      });

      setConversations(prev =>
        prev.map(c =>
          c.id === activeId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === targetMsg.id && m.toolCalls
                    ? {
                        ...m,
                        toolCalls: m.toolCalls.map(tc =>
                          tc.id === toolCallId
                            ? {
                                ...tc,
                                state: res.state,
                                result: res.result,
                                error: res.error,
                                durationMs: res.durationMs
                              }
                            : tc
                        )
                      }
                    : m
                )
              }
            : c
        )
      );

      // Return real integration result back to model to display final answer
      if (res.state === 'completed' && res.result !== undefined) {
        setTimeout(() => {
          feedToolResultBackToModel(activeId, targetTool, res.result);
        }, 150);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Execution error';
      setConversations(prev =>
        prev.map(c =>
          c.id === activeId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === targetMsg.id && m.toolCalls
                    ? {
                        ...m,
                        toolCalls: m.toolCalls.map(tc =>
                          tc.id === toolCallId
                            ? { ...tc, state: 'failed', error: errorMsg }
                            : tc
                        )
                      }
                    : m
                )
              }
            : c
        )
      );
    }
  };

  const handleExecuteToolCall = (toolCallId: string) => {
    handleConfirmToolCall(toolCallId, true);
  };

  // Return the tool execution result back to the model so it can display the final answer in NexusAI
  const feedToolResultBackToModel = async (
    convId: string,
    toolCall: ToolCall,
    result: unknown
  ) => {
    const finalMsgId = `msg_a_ans_${Date.now()}`;
    const finalAssistantMsg: ChatMessage = {
      id: finalMsgId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: selectedModel,
      status: 'streaming'
    };

    setConversations(prev =>
      prev.map(c => {
        if (c.id === convId) {
          return {
            ...c,
            updatedAt: Date.now(),
            messages: [...c.messages, finalAssistantMsg]
          };
        }
        return c;
      })
    );

    const targetConv = conversations.find(c => c.id === convId);
    const existingMessages = targetConv ? targetConv.messages : [];

    const historyPayload = [
      ...existingMessages.map(m => ({
        role: (m.role === 'tool' ? 'user' : m.role) as 'user' | 'assistant' | 'system',
        content: m.content
      })),
      {
        role: 'user' as const,
        content: `[TOOL EXECUTION RESULT FOR: "${toolCall.function.name}"]
${JSON.stringify(result, null, 2)}

Instructions: Based directly on the above real data, please provide a clear, conversational, and direct final answer to the user.`
      }
    ];

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsStreaming(true);

    let accumulatedAns = '';

    try {
      await streamChatCompletion({
        model: selectedModel,
        messages: historyPayload,
        onDelta: (chunk) => {
          accumulatedAns += chunk;
          setConversations(prev =>
            prev.map(c => {
              if (c.id === convId) {
                return {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === finalMsgId ? { ...m, content: accumulatedAns } : m
                  )
                };
              }
              return c;
            })
          );
        },
        signal: controller.signal
      });

      setConversations(prev =>
        prev.map(c => {
          if (c.id === convId) {
            return {
              ...c,
              messages: c.messages.map(m =>
                m.id === finalMsgId
                  ? {
                      ...m,
                      status: 'complete',
                      content: accumulatedAns || 'Action completed successfully.'
                    }
                  : m
              )
            };
          }
          return c;
        })
      );
    } catch (err: unknown) {
      console.warn('Failed to stream final response after tool execution:', err);
      setConversations(prev =>
        prev.map(c => {
          if (c.id === convId) {
            return {
              ...c,
              messages: c.messages.map(m =>
                m.id === finalMsgId
                  ? {
                      ...m,
                      status: 'complete',
                      content: accumulatedAns || 'Execution completed with result.'
                    }
                  : m
              )
            };
          }
          return c;
        })
      );
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // Switch to OpenRouter Free when paid model returns 402 or user requests it
  const handleSwitchToFree = (msgId?: string) => {
    const freeModelId = 'openrouter/free';
    setSelectedModel(freeModelId);
    if (activeId) {
      setConversations(prev =>
        prev.map(c => (c.id === activeId ? { ...c, model: freeModelId } : c))
      );
    }

    if (activeConversation) {
      const messages = activeConversation.messages;
      let targetUserText = '';
      if (msgId) {
        const idx = messages.findIndex(m => m.id === msgId);
        if (idx > 0 && messages[idx - 1].role === 'user') {
          targetUserText = messages[idx - 1].content;
        }
      } else {
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        if (lastUser) targetUserText = lastUser.content;
      }

      if (targetUserText) {
        if (msgId) {
          setConversations(prev =>
            prev.map(c =>
              c.id === activeId
                ? { ...c, messages: c.messages.filter(m => m.id !== msgId) }
                : c
            )
          );
        }
        setTimeout(() => {
          handleSendMessage(targetUserText, freeModelId);
        }, 50);
      }
    }
  };

  // Stop generation
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  };

  // Regenerate last assistant response
  const handleRegenerate = async () => {
    if (!activeConversation || isStreaming) return;
    const msgs = activeConversation.messages;
    if (msgs.length === 0) return;

    // Find the last user message
    let lastUserIndex = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex === -1) return;

    const lastUserPrompt = msgs[lastUserIndex].content;
    const trimmedHistory = msgs.slice(0, lastUserIndex);

    // Update conversation to remove the last user and assistant message
    setConversations(prev =>
      prev.map(c => {
        if (c.id === activeId) {
          return {
            ...c,
            messages: trimmedHistory
          };
        }
        return c;
      })
    );

    // Resend
    setTimeout(() => {
      handleSendMessage(lastUserPrompt);
    }, 50);
  };

  // Conversation Management Handlers
  const handleDeleteConversation = (id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeId === id) {
      const remaining = conversations.filter(c => c.id !== id);
      setActiveId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleRenameConversation = (id: string, newTitle: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, title: newTitle } : c))
    );
  };

  const handlePinConversation = (id: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    );
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all chat conversations? This cannot be undone.')) {
      setConversations([]);
      setActiveId(null);
    }
  };

  const handleClearCurrentChat = () => {
    if (!activeId) return;
    setConversations(prev =>
      prev.map(c => (c.id === activeId ? { ...c, messages: [] } : c))
    );
  };

  const handleExportChat = () => {
    if (activeConversation) {
      exportConversationToMarkdown(activeConversation);
    }
  };

  const handleModelChange = (newModelId: string) => {
    setSelectedModel(newModelId);
    if (activeId) {
      setConversations(prev =>
        prev.map(c => (c.id === activeId ? { ...c, model: newModelId } : c))
      );
    }
  };

  const curatedModels: ModelInfo[] = backendConfig?.curatedModels || [
    {
      id: 'openrouter/free',
      name: 'OpenRouter Free – Automation',
      provider: 'OpenRouter',
      description: 'Free tier router for general chat & automated tool execution without API credits',
      isFree: true,
      badge: 'Free Automation'
    },
    {
      id: 'anthropic/claude-opus-5.5',
      name: 'Claude Opus 5.5',
      provider: 'Anthropic',
      description: 'Frontier Anthropic flagship with peerless depth, reasoning, and coding precision',
      isFree: false,
      badge: 'Opus 5.5'
    },
    {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      provider: 'OpenAI',
      description: 'Flagship omni model with high intelligence and vision',
      isFree: false,
      badge: 'Omni'
    },
    {
      id: 'openai/gpt-4o-mini',
      name: 'GPT-4o Mini',
      provider: 'OpenAI',
      description: 'Fast, cost-efficient, and intelligent OpenAI model',
      isFree: false,
      badge: 'Fast'
    },
    {
      id: 'deepseek/deepseek-chat',
      name: 'DeepSeek V3',
      provider: 'DeepSeek',
      description: 'Ultra-fast, state-of-the-art general purpose model',
      isFree: false,
      badge: 'Popular'
    },
    {
      id: 'deepseek/deepseek-r1',
      name: 'DeepSeek R1',
      provider: 'DeepSeek',
      description: 'Open reasoning model with chain-of-thought problem solving',
      isFree: false,
      isReasoning: true,
      badge: 'Reasoning'
    },
    {
      id: 'meta-llama/llama-3.3-70b-instruct',
      name: 'Llama 3.3 70B',
      provider: 'Meta',
      description: 'High-capability open model with exceptional reasoning and code',
      isFree: false
    },
    {
      id: 'openai/gpt-6-luna-pro',
      name: 'ChatGPT 6 (GPT-6 Luna Pro)',
      provider: 'OpenAI',
      description: 'Frontier reasoning intelligence released Sep 2026 for advanced logic, code & multi-step problems',
      isFree: false,
      isReasoning: true,
      badge: 'GPT-6 Pro'
    }
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d0f17] text-slate-100 font-sans antialiased">
      {/* Sidebar Navigation */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelectConversation={(id) => setActiveId(id)}
        onNewChat={() => createNewChat()}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        onPinConversation={handlePinConversation}
        onClearAll={handleClearAll}
        isKeyConfigured={Boolean(backendConfig?.isKeyConfigured)}
        onOpenSetup={() => setIsSetupOpen(true)}
        defaultModel={selectedModel}
      />

      {/* Main Chat Viewport */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-[#0e111a]">
        {/* Top Bar Contract (Zone 1: Brand/Toggle, Zone 2: Model Selector, Zone 3: Actions) */}
        <ChatHeader
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
          currentModel={selectedModel}
          modelsList={curatedModels}
          onOpenModelSelector={() => setIsModelSelectorOpen(true)}
          onExportChat={handleExportChat}
          onClearChat={handleClearCurrentChat}
          onOpenSetup={() => setIsSetupOpen(true)}
          isKeyConfigured={Boolean(backendConfig?.isKeyConfigured)}
          hasMessages={currentMessages.length > 0}
        />

        {/* Message Feed Area */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {currentMessages.length === 0 ? (
            <EmptyState
              currentModel={selectedModel}
              modelsList={curatedModels}
              onSelectPrompt={(prompt) => handleSendMessage(prompt)}
              isKeyConfigured={Boolean(backendConfig?.isKeyConfigured)}
              onOpenSetup={() => setIsSetupOpen(true)}
            />
          ) : (
            <div className="flex-1 pb-4">
              {currentMessages.map((msg, index) => {
                const isLastAssistant =
                  msg.role === 'assistant' &&
                  index === currentMessages.length - 1;

                return (
                  <MessageItem
                    key={msg.id}
                    message={msg}
                    isLastAssistant={isLastAssistant}
                    onRegenerate={handleRegenerate}
                    onSwitchToFree={() => handleSwitchToFree(msg.id)}
                    onConfirmToolCall={handleConfirmToolCall}
                    onExecuteToolCall={handleExecuteToolCall}
                    isStreaming={isStreaming && isLastAssistant}
                  />
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <ChatInput
          input={input}
          setInput={setInput}
          onSubmit={() => handleSendMessage()}
          onStop={handleStop}
          isStreaming={isStreaming}
        />
      </main>

      {/* Setup & Server Status Modal */}
      <SetupModal
        isOpen={isSetupOpen}
        onClose={() => setIsSetupOpen(false)}
        config={backendConfig}
        onRefreshConfig={refreshConfig}
      />

      {/* Model Selector Modal */}
      <ModelSelectorModal
        isOpen={isModelSelectorOpen}
        onClose={() => setIsModelSelectorOpen(false)}
        currentModel={selectedModel}
        onSelectModel={handleModelChange}
        curatedModels={curatedModels}
      />
    </div>
  );
}
