import { RiskLevel } from '../types.js';
import { executeTool, getTool, ToolContext } from './ai/toolRegistry.js';
import { AgentMessage, getProvider } from './ai/providers.js';
import { getSetting, SETTINGS } from './appSettings.js';

/**
 * AI Agent
 * --------
 * Provider-agnostic function-calling loop over the shared Tool Registry.
 * The active model comes from `getProvider()` (VITE_AI_PROVIDER: gemini | groq).
 *
 * Governance baked in:
 *  - read / low-risk tools execute automatically inside the loop.
 *  - high-risk tools pause and return `pendingApproval`; the UI must call
 *    `approvePending` (or `rejectPending`) to continue.
 */

const MAX_TOOL_HOPS = 6;

// Cap how much of a tool result we feed back to the model. Free-tier LLMs have
// tight tokens-per-minute limits, so a tool that returns the whole DB would blow
// the budget (Groq 413). We trim long arrays and hard-cap the serialized size.
const MAX_ARRAY_ITEMS = 20;
const MAX_RESULT_CHARS = 6000;

const trimArrays = (v: any): any => {
  if (Array.isArray(v)) {
    const out = v.slice(0, MAX_ARRAY_ITEMS).map(trimArrays);
    if (v.length > MAX_ARRAY_ITEMS) {
      out.push(`…(+${v.length - MAX_ARRAY_ITEMS} more; refine with a filter or ask for a specific item)`);
    }
    return out;
  }
  return v;
};

const clampForModel = (result: any): any => {
  let out = result;
  if (result && typeof result === 'object' && 'data' in result) {
    out = { ...result, data: trimArrays((result as any).data) };
  } else {
    out = trimArrays(result);
  }
  let json = '';
  try {
    json = JSON.stringify(out);
  } catch {
    return out;
  }
  if (json.length > MAX_RESULT_CHARS) {
    return {
      truncated: true,
      note: 'Result too large and was truncated to fit token limits. Ask for a specific item or apply a filter.',
      preview: json.slice(0, MAX_RESULT_CHARS),
    };
  }
  return out;
};

interface PendingAction {
  tool: string;
  args: Record<string, any>;
  risk: RiskLevel;
  summary: string;
  callId: string;
}

/** A file the agent wants the channel (Telegram/WhatsApp/app) to deliver. */
export interface DeliverItem {
  kind: 'document' | 'photo';
  url: string;
  filename?: string;
  caption?: string;
}

/**
 * Pull any `__deliver` files out of a tool result so they are sent to the user
 * directly (as real files) instead of being fed back to the model as tokens.
 */
const extractDeliveries = (result: any): { clean: any; items: DeliverItem[] } => {
  if (result && typeof result === 'object' && Array.isArray(result.__deliver)) {
    const { __deliver, ...rest } = result;
    const items: DeliverItem[] = __deliver
      .filter((d: any) => d && d.url)
      .map((d: any) => ({
        kind: d.kind === 'photo' ? 'photo' : 'document',
        url: String(d.url),
        filename: d.filename ? String(d.filename) : undefined,
        caption: d.caption ? String(d.caption) : undefined,
      }));
    return { clean: rest, items };
  }
  return { clean: result, items: [] };
};

export interface AgentState {
  contents: AgentMessage[];
  pending?: PendingAction;
}

export interface AgentResponse {
  state: AgentState;
  text?: string;
  pendingApproval?: PendingAction;
  error?: string;
  attachments?: DeliverItem[];
}

export const isAIConfigured = (): boolean => getProvider().isConfigured();

export const newConversation = (): AgentState => ({ contents: [] });

const systemText = (ctx: ToolContext) => {
  const base =
    `You are the Tintura assistant, an operations co-pilot for a garment ` +
    `manufacturing system (MES). The current user is "${ctx.actor}" with role ${ctx.role}.\n\n` +
    `Rules:\n` +
    `- Use the provided tools to answer questions and perform actions. Prefer real ` +
    `data from tools over guessing.\n` +
    `- Read-only and low-risk actions run automatically. High-risk actions (creating ` +
    `orders/requests, changing status, deletes) will be paused for human approval — ` +
    `that is expected; just call the tool and the system handles approval.\n` +
    `- Never invent order numbers, styles, or quantities. If unsure, look them up.\n` +
    `- Users may write in English, Tamil, or Tanglish (Tamil typed in English ` +
    `letters). Understand all three, but ALWAYS reply in clear, simple English.\n` +
    `- Be concise and factory-floor practical. Summarise results clearly.`;

  // Optional Tech-Manager override appended to the base rules.
  const override = getSetting(SETTINGS.AI_SYSTEM_PROMPT).trim();
  return override ? `${base}\n\nAdditional instructions:\n${override}` : base;
};

const runLoop = async (state: AgentState, ctx: ToolContext): Promise<AgentResponse> => {
  const provider = getProvider();
  const deliveries: DeliverItem[] = [];
  const withFiles = (resp: AgentResponse): AgentResponse =>
    deliveries.length ? { ...resp, attachments: deliveries } : resp;

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    let turn;
    try {
      turn = await provider.chat(state.contents, ctx.role, systemText(ctx));
    } catch (err: any) {
      return withFiles({ state, error: err.message });
    }

    if (!turn.toolCall) {
      const text = turn.text || 'Done.';
      state.contents.push({ role: 'assistant', text });
      return withFiles({ state, text });
    }

    const call = turn.toolCall;
    state.contents.push({ role: 'assistant', toolCall: call });

    const tool = getTool(call.name);
    if (tool && tool.risk === 'high') {
      state.pending = {
        tool: call.name,
        args: call.args || {},
        risk: tool.risk,
        summary: tool.description,
        callId: call.id,
      };
      return withFiles({ state, pendingApproval: state.pending });
    }

    const result = await executeTool(call.name, call.args || {}, ctx);
    const { clean, items } = extractDeliveries(result);
    if (items.length) deliveries.push(...items);
    state.contents.push({ role: 'tool', toolCallId: call.id, name: call.name, result: clampForModel(clean) });
  }

  return withFiles({ state, text: 'Stopped after too many tool steps. Please refine the request.' });
};

/** Send a new user message and run the agent until text or an approval pause. */
export const sendUserMessage = async (
  state: AgentState,
  userText: string,
  ctx: ToolContext
): Promise<AgentResponse> => {
  state.contents.push({ role: 'user', text: userText });
  return runLoop(state, ctx);
};

/** Approve the paused high-risk tool, execute it, then continue. */
export const approvePending = async (
  state: AgentState,
  ctx: ToolContext
): Promise<AgentResponse> => {
  if (!state.pending) return { state, error: 'Nothing pending approval.' };
  const { tool, args, callId } = state.pending;
  const result = await executeTool(tool, args, { ...ctx, approved: true });
  const { clean, items } = extractDeliveries(result);
  state.contents.push({ role: 'tool', toolCallId: callId, name: tool, result: clampForModel(clean) });
  state.pending = undefined;
  const resp = await runLoop(state, ctx);
  return items.length ? { ...resp, attachments: [...items, ...(resp.attachments || [])] } : resp;
};

/** Reject the paused high-risk tool and let the agent continue without it. */
export const rejectPending = async (
  state: AgentState,
  ctx: ToolContext
): Promise<AgentResponse> => {
  if (!state.pending) return { state, error: 'Nothing pending approval.' };
  const { tool, callId } = state.pending;
  state.contents.push({
    role: 'tool',
    toolCallId: callId,
    name: tool,
    result: { status: 'rejected', reason: 'User declined this action.' },
  });
  state.pending = undefined;
  return runLoop(state, ctx);
};