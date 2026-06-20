import { UserRole } from '../../types.js';
import { getToolsForRole, AITool } from './toolRegistry.js';

/**
 * LLM Provider Layer
 * ------------------
 * One neutral interface, many backends. The agent loop (geminiService.ts) and
 * the Tool Registry never know which model is answering. Switch providers with
 * a single env var: VITE_AI_PROVIDER = gemini | groq.
 *
 *  - gemini : Google Generative Language API (needs billing on this key — its
 *             free tier is limited to 0 in this region).
 *  - groq   : Groq Cloud (free, OpenAI-compatible, strong tool-calling, works
 *             everywhere). Good for Tanglish text; pair with Whisper later for
 *             Tamil/Tanglish voice.
 */

const getEnv = (key: string): string | undefined => {
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    // @ts-ignore
    return import.meta.env[key];
  }
  // Server-side (serverless functions / Node) fallback.
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return undefined;
};

// ---- Neutral conversation format ---------------------------------------
export type AgentMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text?: string;
      toolCall?: { id: string; name: string; args: Record<string, any> };
    }
  | { role: 'tool'; toolCallId: string; name: string; result: any };

export interface AssistantTurn {
  text?: string;
  toolCall?: { id: string; name: string; args: Record<string, any> };
}

export interface LLMProvider {
  id: string;
  label: string;
  isConfigured(): boolean;
  chat(messages: AgentMessage[], role: UserRole, system: string): Promise<AssistantTurn>;
}

// ---- Shared retry helpers ----------------------------------------------
const MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const parseRetryDelayMs = (errText: string): number | null => {
  const m = errText.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  const m2 = errText.match(/try again in ([\d.]+)s/i);
  if (m2) return Math.ceil(parseFloat(m2[1]) * 1000);
  return null;
};

// ======================================================================
// Gemini provider
// ======================================================================
const GEMINI_TYPE: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  boolean: 'BOOLEAN',
};

const geminiDeclarations = (role: UserRole) =>
  getToolsForRole(role).map((tool) => {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    Object.entries(tool.parameters).forEach(([name, p]) => {
      properties[name] = { type: GEMINI_TYPE[p.type] || 'STRING', description: p.description };
      if (p.required) required.push(name);
    });
    return {
      name: tool.name,
      description: `[risk:${tool.risk}] ${tool.description}`,
      parameters: { type: 'OBJECT', properties, required },
    };
  });

const toGeminiContents = (messages: AgentMessage[]) =>
  messages.map((m) => {
    if (m.role === 'user') return { role: 'user', parts: [{ text: m.text }] };
    if (m.role === 'tool')
      return {
        role: 'function',
        parts: [{ functionResponse: { name: m.name, response: { result: m.result } } }],
      };
    if (m.toolCall)
      return {
        role: 'model',
        parts: [{ functionCall: { name: m.toolCall.name, args: m.toolCall.args } }],
      };
    return { role: 'model', parts: [{ text: m.text || '' }] };
  });

class GeminiProvider implements LLMProvider {
  id = 'gemini';
  label = 'Google Gemini';
  private key = getEnv('VITE_GEMINI_API_KEY') || getEnv('GEMINI_API_KEY') || getEnv('GOOGLE_API_KEY');
  private model = getEnv('VITE_GEMINI_MODEL') || getEnv('GEMINI_MODEL') || 'gemini-2.5-flash';

  isConfigured() {
    return !!this.key;
  }

  async chat(messages: AgentMessage[], role: UserRole, system: string): Promise<AssistantTurn> {
    if (!this.key) throw new Error('Gemini API key not configured (VITE_GEMINI_API_KEY / GEMINI_API_KEY).');

    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: toGeminiContents(messages),
      tools: [{ function_declarations: geminiDeclarations(role) }],
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.key}`;

    let lastErr = '';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const fc = parts.find((p: any) => p.functionCall)?.functionCall;
        if (fc) return { toolCall: { id: `call_${fc.name}`, name: fc.name, args: fc.args || {} } };
        const text = parts
          .filter((p: any) => p.text)
          .map((p: any) => p.text)
          .join('\n')
          .trim();
        return { text };
      }

      const errText = await res.text();
      lastErr = errText;
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(parseRetryDelayMs(errText) ?? Math.min(2000 * 2 ** attempt, 12000));
        continue;
      }
      if (res.status === 429)
        throw new Error(
          'Gemini quota reached. Enable billing on the Gemini project (paid tier has far higher limits), ' +
            'or temporarily set VITE_AI_PROVIDER=groq.'
        );
      throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
    }
    throw new Error(`Gemini API error after retries: ${lastErr.slice(0, 300)}`);
  }
}

// ======================================================================
// Groq provider (OpenAI-compatible)
// ======================================================================
const jsonSchema = (tool: AITool) => {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  Object.entries(tool.parameters).forEach(([name, p]) => {
    properties[name] = { type: p.type, description: p.description };
    if (p.required) required.push(name);
  });
  return { type: 'object', properties, required };
};

const groqTools = (role: UserRole) =>
  getToolsForRole(role).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: `[risk:${tool.risk}] ${tool.description}`,
      parameters: jsonSchema(tool),
    },
  }));

const toGroqMessages = (messages: AgentMessage[], system: string) => {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text });
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: JSON.stringify(m.result) });
    } else if (m.toolCall) {
      out.push({
        role: 'assistant',
        content: m.text || '',
        tool_calls: [
          {
            id: m.toolCall.id,
            type: 'function',
            function: { name: m.toolCall.name, arguments: JSON.stringify(m.toolCall.args) },
          },
        ],
      });
    } else {
      out.push({ role: 'assistant', content: m.text || '' });
    }
  }
  return out;
};

class GroqProvider implements LLMProvider {
  id = 'groq';
  label = 'Groq';
  private key = getEnv('VITE_GROQ_API_KEY') || getEnv('GROQ_API_KEY');
  private model = getEnv('VITE_GROQ_MODEL') || getEnv('GROQ_MODEL') || 'llama-3.3-70b-versatile';

  isConfigured() {
    return !!this.key;
  }

  async chat(messages: AgentMessage[], role: UserRole, system: string): Promise<AssistantTurn> {
    if (!this.key) throw new Error('Groq API key not configured (VITE_GROQ_API_KEY).');

    // On a rate-limit (TPM) hit we fall back to a lighter model that has a much
    // higher free-tier budget, so the assistant degrades instead of failing.
    const FALLBACK_MODEL = 'llama-3.1-8b-instant';
    const body: any = {
      model: this.model,
      messages: toGroqMessages(messages, system),
      tools: groqTools(role),
      tool_choice: 'auto',
      temperature: 0.2,
    };

    let lastErr = '';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.key}`,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        const msg = data?.choices?.[0]?.message;
        const tc = msg?.tool_calls?.[0];
        if (tc) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(tc.function?.arguments || '{}');
          } catch {
            args = {};
          }
          return { toolCall: { id: tc.id, name: tc.function?.name, args } };
        }
        return { text: (msg?.content || '').trim() };
      }

      const errText = await res.text();
      lastErr = errText;
      if (res.status === 429 && body.model !== FALLBACK_MODEL) {
        // Switch to the lighter model and retry immediately (no long wait).
        body.model = FALLBACK_MODEL;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(Math.min(parseRetryDelayMs(errText) ?? 2000 * 2 ** attempt, 8000));
        continue;
      }
      if (res.status === 401)
        throw new Error('Groq API key invalid (VITE_GROQ_API_KEY). Get one at console.groq.com/keys.');
      throw new Error(`Groq API error ${res.status}: ${errText.slice(0, 300)}`);
    }
    throw new Error(`Groq API error after retries: ${lastErr.slice(0, 300)}`);
  }
}

// ======================================================================
// Selection
// ======================================================================
const PROVIDERS: Record<string, LLMProvider> = {
  gemini: new GeminiProvider(),
  groq: new GroqProvider(),
};

/**
 * The active provider. An explicit VITE_AI_PROVIDER / AI_PROVIDER always wins.
 * Otherwise we auto-pick Gemini when a Gemini key is present (paid tier, high
 * limits), and fall back to Groq.
 */
export const getProvider = (): LLMProvider => {
  const explicit = (getEnv('VITE_AI_PROVIDER') || getEnv('AI_PROVIDER') || '').toLowerCase();
  if (explicit && PROVIDERS[explicit]) return PROVIDERS[explicit];
  if (PROVIDERS.gemini.isConfigured()) return PROVIDERS.gemini;
  return PROVIDERS.groq;
};
