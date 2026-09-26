// Vercel Serverless Function for GET /api/config
import { UNIFIED_TOOL_REGISTRY } from '../server/toolExecutor';

export const config = {
  runtime: 'nodejs'
};

const CURATED_MODELS = [
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
    isFree: false,
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

export default async function handler(req: Request) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || '';
  const isKeyConfigured = Boolean(
    apiKey &&
    apiKey !== 'your_openrouter_api_key_here' &&
    !apiKey.startsWith('sk-or-v1-xxxx')
  );

  const defaultModel = process.env.DEFAULT_AI_MODEL || 'anthropic/claude-opus-5.5';
  const systemPrompt = process.env.SYSTEM_PROMPT || 'You are Claude Opus 5.5, an advanced frontier AI assistant created by Anthropic. You are thoughtful, precise, articulate, and skilled in deep reasoning, code generation, and complex analysis. Format your responses with clean Markdown, helpful code snippets with language tags, and clear explanations.';

  return new Response(
    JSON.stringify({
      status: 'ok',
      isKeyConfigured,
      defaultModel,
      systemPrompt,
      curatedModels: CURATED_MODELS,
      availableTools: Object.values(UNIFIED_TOOL_REGISTRY).map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        sensitivity: t.sensitivity
      })),
      version: '1.0.0',
      deploymentPlatform: 'vercel'
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    }
  );
}
