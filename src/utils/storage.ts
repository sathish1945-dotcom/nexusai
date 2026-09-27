import { Conversation } from '../types/chat';

const STORAGE_KEY = 'nexusai_chat_conversations_v1';
const ACTIVE_CONV_KEY = 'nexusai_active_conv_id';

export function loadStoredConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.warn('Failed to parse conversations from localStorage:', err);
    return [];
  }
}

export function saveStoredConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch (err) {
    console.warn('Failed to persist conversations to localStorage:', err);
  }
}

export function loadStoredActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CONV_KEY);
  } catch {
    return null;
  }
}

export function saveStoredActiveId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_CONV_KEY, id);
  } catch {
    // Ignore storage errors
  }
}

export function exportConversationToMarkdown(conv: Conversation): void {
  let md = `# ${conv.title || 'Chat Conversation'}\n`;
  md += `**Date**: ${new Date(conv.createdAt).toLocaleString()}\n`;
  md += `**Model**: \`${conv.model}\`\n\n---\n\n`;

  for (const msg of conv.messages) {
    const roleName = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Setup' : 'System';
    const timeStr = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    md += `### ${roleName} (${timeStr})\n\n${msg.content}\n\n`;
  }

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(conv.title || 'conversation').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportConversationToJSON(conv: Conversation): void {
  const jsonStr = JSON.stringify(conv, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(conv.title || 'conversation').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
