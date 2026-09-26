// Vercel Serverless Function for POST /api/chat
import { getAllowlistedOpenRouterTools } from '../server/toolExecutor';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || '';

  if (!apiKey || apiKey === 'your_openrouter_api_key_here' || apiKey.startsWith('sk-or-v1-xxxx')) {
    return new Response(
      JSON.stringify({
        error: 'OPENROUTER_API_KEY is not configured on the server.',
        code: 'MISSING_API_KEY',
        details: 'Please add your OPENROUTER_API_KEY to your Vercel Project Settings > Environment Variables.'
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = await req.json();
    const { messages, model, temperature = 0.7, stream = true } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Invalid request: "messages" must be a non-empty array of chat messages.',
          code: 'INVALID_PAYLOAD'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const selectedModel = model?.trim() || process.env.DEFAULT_AI_MODEL || 'anthropic/claude-opus-5.5';
    const defaultSystemPrompt = process.env.SYSTEM_PROMPT || 'You are Claude Opus 5.5, an advanced frontier AI assistant created by Anthropic. You are thoughtful, precise, articulate, and skilled in deep reasoning, code generation, and complex analysis. Format your responses with clean Markdown, helpful code snippets with language tags, and clear explanations.';

    const sanitizedMessages = [...messages];
    const hasSystem = sanitizedMessages.some((m) => m && m.role === 'system');
    if (!hasSystem && defaultSystemPrompt) {
      sanitizedMessages.unshift({
        role: 'system',
        content: defaultSystemPrompt
      });
    }

    const isReasoningModel =
      selectedModel.includes('gpt-6') ||
      selectedModel.includes('luna') ||
      selectedModel.includes('r1') ||
      selectedModel.includes('o1') ||
      selectedModel.includes('o3');

    const reqJson = await req.clone().json().catch(() => ({}));
    const maxTokens = Math.min(4096, Math.max(50, Number(reqJson.max_tokens) || 1500));

    const openRouterPayload: Record<string, unknown> = {
      model: selectedModel,
      messages: sanitizedMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
        content: String(m.content || '')
      })),
      temperature: Math.max(0, Math.min(2, Number(temperature) || 0.7)),
      max_tokens: maxTokens,
      stream: Boolean(stream)
    };

    // Strict Allowlisted Tools Only: AI model cannot receive arbitrary or unvetted tools
    openRouterPayload.tools = getAllowlistedOpenRouterTools();
    openRouterPayload.tool_choice = reqJson.tool_choice || 'auto';

    if (isReasoningModel) {
      openRouterPayload.reasoning = {};
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.APP_URL || 'https://vercel.app',
        'X-Title': 'NexusAI Chatbot'
      },
      body: JSON.stringify(openRouterPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(errText, {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (stream && response.body) {
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    return new Response(
      JSON.stringify({
        error: 'Failed to process chat completion.',
        details: (error as Error).message
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
