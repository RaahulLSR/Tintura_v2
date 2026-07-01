import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  OrderStatus,
  formatOrderNumber,
  getNextOrderStatus,
  MaterialStage,
  MATERIAL_STAGE_ORDER,
  MATERIAL_STAGE_LABEL,
  prevMaterialStage,
  nextMaterialStage,
  procurementStageQty,
  POSTER_KEY,
  CUSTOM_KEY,
  getSizeKeyFromLabel,
  getStylePoster,
  getStyleCustomItems,
} from '../types.js';
import type { Order, Style, Attachment, MaterialProcurement, StockCommitLine, SalesOrderLine, SalesOrder, ConsumptionType, OrderStockCommit } from '../types.js';
import {
  fetchStyleByNumber,
  fetchOrders,
  updateOrderStatus,
  upsertStyle,
  fetchProcurements,
  advanceProcurement,
  regressProcurement,
  createProcurement,
  commitOrderStock,
  fetchOrderStockCommits,
  undoOrderStockCommit,
  fetchStockLevels,
  createSalesOrder,
  forwardSalesOrder,
  fetchBuyers,
  fetchSalesOrders,
  addOrderLog,
} from '../services/db.js';
import { normalizeSize, combinedSizeLabel, CANONICAL_SIZES } from '../services/sizes.js';
import { buildPoPdfBytes } from '../services/poPdf.js';
import { allowedBotActions, canUseBotAction } from '../services/botAccess.js';

/**
 * Telegram Bot — command / button driven
 * --------------------------------------
 * Every action runs a deterministic function (fetch style files, measurement
 * chart, style summary, order status, advance status). No LLM tokens are spent
 * on these. AI is used in EXACTLY one place: turning a spoken voice note into a
 * single structured status update {order_number, status}. Nothing more.
 *
 * Set the webhook once:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<app>/api/telegram-webhook&secret_token=<SECRET>
 *
 * Required env vars (Vercel):
 *   TELEGRAM_BOT_TOKEN          - from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET     - must match setWebhook secret_token
 *   VITE_SUPABASE_URL / SUPABASE key - DB access
 * Optional:
 *   GEMINI_API_KEY / GROQ_API_KEY    - voice transcription + status parsing
 *   TELEGRAM_ALLOWED_CHAT_IDS        - comma-separated allow-list
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

const GROQ_KEY =
  process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY || process.env.GROQ_KEY;

const GEMINI_KEY =
  process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL =
  process.env.VITE_GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const sendTelegram = async (
  token: string,
  chatId: number | string,
  text: string,
  replyMarkup?: any
) => {
  // When a caller passes the full MAIN_MENU, automatically filter it down to
  // the actions this chat's role is allowed to use — so users only ever see
  // buttons they have access to. Already-filtered keyboards pass through as-is.
  let markup = replyMarkup;
  if (markup === MAIN_MENU) {
    try {
      const access = await loadBotAccess(chatId);
      markup = menuForRole(access.role);
    } catch {
      markup = MAIN_MENU;
    }
  }
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: markup }),
  });
};

/** Stop the loading spinner on a tapped inline button. */
const answerCallback = async (token: string, callbackId: string, text?: string) => {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
};

/** The main menu of tappable actions (no AI, no tokens). */
const MAIN_MENU = {
  inline_keyboard: [
    [{ text: '📄 Tech Pack files', callback_data: 'act:files' }],
    [{ text: '📏 Measurement chart', callback_data: 'act:measure' }],
    [{ text: '🧾 Style summary', callback_data: 'act:summary' }],
    [{ text: '📎 Add files to a style', callback_data: 'act:upload' }],
    [{ text: '➕ Add quantity / requirement', callback_data: 'act:reqadd' }],
    [{ text: '📦 Order status & actions', callback_data: 'act:order' }],
    [{ text: '📋 Active orders', callback_data: 'act:orders' }],
    [{ text: '🧵 Order materials', callback_data: 'act:matorder' }],
    [{ text: '📥 Materials to action', callback_data: 'act:matpend' }],
    [{ text: '🆕 New material request', callback_data: 'act:newmat' }],
    [{ text: '🧾 Raise PO (new sale)', callback_data: 'act:newpo' }],
    [{ text: '📄 Send a PO PDF', callback_data: 'act:popdf' }],
    [{ text: '📥 Commit stock to inventory', callback_data: 'act:commit' }],
    [{ text: '🔎 Inventory lookup', callback_data: 'act:stock' }],
    [{ text: '📊 Daily summary', callback_data: 'act:daily' }],
    [{ text: '🎙️ Voice update (order / material)', callback_data: 'act:voice' }],
    [{ text: '🤖 Ask AI a question', callback_data: 'act:ai' }],
    [{ text: '↩️ Undo last action', callback_data: 'undo:last' }],
  ],
};

const sendMenu = async (token: string, chatId: number | string, intro?: string) => {
  const access = await loadBotAccess(chatId);
  return sendTelegram(
    token,
    chatId,
    intro || 'What do you need? Tap an option below.',
    menuForRole(access.role)
  );
};

type SendResult = { ok: boolean; description?: string };

/** Send a file by URL as a document (PDFs, drawings, generic files). */
const sendTelegramDocument = async (
  token: string,
  chatId: number | string,
  url: string,
  caption?: string
): Promise<SendResult> => {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, document: url, caption: caption?.slice(0, 1000) }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: !!data?.ok, description: data?.description };
};

/** Send a file by URL as a photo (images). */
const sendTelegramPhoto = async (
  token: string,
  chatId: number | string,
  url: string,
  caption?: string
): Promise<SendResult> => {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: url, caption: caption?.slice(0, 1000) }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: !!data?.ok, description: data?.description };
};

/** Transcribe an audio buffer with Gemini's native audio understanding (Tamil/English/Tanglish). */
const transcribeWithGemini = async (buf: Buffer, mime: string): Promise<string | null> => {
  if (!GEMINI_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  'Transcribe this voice note verbatim. It may be in Tamil, English, or Tanglish ' +
                  '(Tamil spoken with English words / written in Latin script). Return ONLY the transcript text, no commentary.',
              },
              { inline_data: { mime_type: mime || 'audio/ogg', data: buf.toString('base64') } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join('\n')
      .trim();
    return text || null;
  } catch {
    return null;
  }
};

/** Transcribe an audio buffer with Groq Whisper (fallback when no Gemini key). */
const transcribeWithGroq = async (buf: Buffer, mime: string): Promise<string | null> => {
  if (!GROQ_KEY) return null;
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: mime || 'audio/ogg' }), 'voice.ogg');
    form.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3');
    const tr = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: form as any,
    });
    const data = await tr.json();
    return data?.text || null;
  } catch {
    return null;
  }
};

/** Download a Telegram voice/audio file and transcribe it (Gemini first, Groq fallback). */
const transcribeTelegram = async (token: string, fileId: string, mime?: string): Promise<string | null> => {
  if (!GEMINI_KEY && !GROQ_KEY) return null;
  try {
    const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const meta = await metaRes.json();
    const path = meta?.result?.file_path;
    if (!path) return null;
    const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
    const buf = Buffer.from(await audioRes.arrayBuffer());
    const type = mime || 'audio/ogg';
    return (await transcribeWithGemini(buf, type)) || (await transcribeWithGroq(buf, type));
  } catch {
    return null;
  }
};

const featureEnabled = async (key: string): Promise<boolean> => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return false;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await supabase.from('feature_toggles').select('enabled').eq('key', key).maybeSingle();
    return !!data?.enabled;
  } catch {
    return false;
  }
};

// --- Per-chat access control (maps a Telegram chat to an app_users role) -----
// `enforced` is false until at least one user has a telegram_chat_id set, so a
// fresh install keeps working (bootstrap = full access). Cached per-invocation.
type BotAccess = { enforced: boolean; registered: boolean; role: string | null; username?: string };
const botAccessCache = new Map<string, BotAccess>();

const loadBotAccess = async (chatId: number | string): Promise<BotAccess> => {
  const key = String(chatId);
  if (botAccessCache.has(key)) return botAccessCache.get(key)!;
  let result: BotAccess = { enforced: false, registered: true, role: 'ADMIN' };
  try {
    if (SUPABASE_URL && SUPABASE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: anyRows } = await supabase
        .from('app_users')
        .select('id')
        .not('telegram_chat_id', 'is', null)
        .limit(1);
      const enforced = !!(anyRows && anyRows.length);
      if (enforced) {
        const { data } = await supabase
          .from('app_users')
          .select('username, role')
          .eq('telegram_chat_id', key)
          .maybeSingle();
        result = data
          ? { enforced: true, registered: true, role: data.role, username: data.username }
          : { enforced: true, registered: false, role: null };
      }
    }
  } catch {
    // On any error, fail open (full access) so a glitch can't lock everyone out.
    result = { enforced: false, registered: true, role: 'ADMIN' };
  }
  botAccessCache.set(key, result);
  return result;
};

/** The main menu filtered to the actions this chat's role may use. */
const menuForRole = (role: string | null): { inline_keyboard: any[][] } => {
  const allowed = new Set(allowedBotActions(role));
  return {
    inline_keyboard: MAIN_MENU.inline_keyboard.filter((row) => {
      const cd = (row[0] as any)?.callback_data as string | undefined;
      return !cd || !cd.startsWith('act:') || allowed.has(cd);
    }),
  };
};

// --- Per-chat flow state ----------------------------------------------------
// A tiny state machine per chat: "I asked for a style number, what action was
// it for?". Stored in Supabase so it survives between serverless invocations.
// Degrades gracefully if the telegram_sessions table is missing.

type Flow = {
  awaiting?:
    | 'style:files'
    | 'style:measure'
    | 'style:summary'
    | 'order'
    | 'upload:style'
    | 'upload:file'
    | 'req:style'
    | 'req:line'
    | 'matorder'
    | 'proc:invoice'
    | 'newmat:order'
    | 'newmat:name'
    | 'newmat:qty'
    | 'commit:order'
    | 'stock:style'
    | 'po:buyer'
    | 'po:number'
    | 'po:line_style'
    | 'po:line_sizes'
    | 'po:line_rate'
    | 'note:order'
    | 'ai';
  pendingUpdate?: { orderId: string; orderNo: string; status: OrderStatus; current: OrderStatus };
  // A free-text floor note waiting for the order it belongs to.
  pendingNote?: string;
  // Image URLs (already uploaded) waiting to be attached to that note's order.
  pendingImages?: string[];
  // Button-driven file upload into a style.
  upload?: { styleNumber: string; destinations: string[]; dest?: string; destLabel?: string };
  // In-progress per-piece production requirement being added to a style.
  req?: { styleNumber: string };
  // The last requirement saved in this flow, so a follow-up photo can attach to it.
  reqLast?: { styleNumber: string; fieldName: string; colorKey?: string };
  // A pending procurement stage advance that is waiting on an invoice number.
  procPending?: { procId: string; material: string; toStage: MaterialStage; qty: number };
  // In-progress new material request being built step by step.
  newMat?: { orderId?: string | null; orderNo?: string; styleNumber?: string; material?: string };
  // In-progress sales purchase order (PO) being built step by step.
  poBuilder?: {
    buyer_name?: string;
    po_number?: string;
    lines: SalesOrderLine[];
    curStyle?: string;
    curSizes?: Record<string, number>;
    curQty?: number;
  };
  // The most recent reversible action, so the user can tap "Undo" or send /undo.
  lastAction?:
    | { kind: 'material_advance'; procId: string; material: string; unit: string; fromStage: MaterialStage; toStage: MaterialStage; qty: number; at: string }
    | { kind: 'material_regress'; procId: string; material: string; unit: string; fromStage: MaterialStage; toStage: MaterialStage; qty: number; at: string }
    | { kind: 'stock_commit'; commitId: string; orderId: string; orderNo: string; total: number; at: string }
    | { kind: 'order_status'; orderId: string; orderNo: string; prevStatus: OrderStatus; newStatus: OrderStatus; at: string };
};

const FLOW_TTL_MINUTES = 30;

const loadFlow = async (chatId: number | string): Promise<Flow> => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return {};
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await supabase
      .from('telegram_sessions')
      .select('flow, updated_at')
      .eq('chat_id', String(chatId))
      .maybeSingle();
    if (!data?.flow) return {};
    if (data.updated_at) {
      const ageMin = (Date.now() - new Date(data.updated_at).getTime()) / 60000;
      if (ageMin > FLOW_TTL_MINUTES) return {}; // stale — forget what we were waiting for
    }
    return data.flow as Flow;
  } catch {
    return {};
  }
};

const saveFlow = async (chatId: number | string, flow: Flow): Promise<void> => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    await supabase
      .from('telegram_sessions')
      .upsert({ chat_id: String(chatId), flow, updated_at: new Date().toISOString() });
  } catch {
    /* table not created yet — single-step actions still work */
  }
};

const clearFlow = (chatId: number | string) => saveFlow(chatId, {});

// --- Undo / corrections -----------------------------------------------------
// Every reversible action stamps a `lastAction` onto the flow. The user can then
// tap "↩️ Undo" or send /undo to roll it back. This keeps the bot forgiving for
// the materials desk, where a wrong tap should never be a dead end.

/** Inline keyboard offering to undo the action that just happened. */
const undoMarkup = () => ({
  inline_keyboard: [
    [{ text: '↩️ Undo that', callback_data: 'undo:last' }],
    [{ text: '⬅️ Menu', callback_data: 'menu' }],
  ],
});

/** Remember the last reversible action (also clears any in-progress flow). */
const recordLastAction = (chatId: number | string, action: NonNullable<Flow['lastAction']>) =>
  saveFlow(chatId, { lastAction: action });

/** Reverse whatever the user last did, if it is still undoable. */
const runUndoLast = async (token: string, chatId: number | string) => {
  const flow = await loadFlow(chatId);
  const a = flow.lastAction;
  if (!a) return sendTelegram(token, chatId, 'Nothing to undo right now. Undo only works on your most recent action.', MAIN_MENU);
  try {
    if (a.kind === 'material_advance') {
      await regressProcurement(a.procId, a.qty, a.toStage, { note: 'Undo via Telegram', created_by_name: 'Telegram' });
      await clearFlow(chatId);
      return sendTelegram(token, chatId, `↩️ Undone — ${a.qty} ${a.unit} pulled back ${MATERIAL_STAGE_LABEL[a.toStage]} → ${MATERIAL_STAGE_LABEL[a.fromStage]} for ${a.material}.`, MAIN_MENU);
    }
    if (a.kind === 'material_regress') {
      await advanceProcurement(a.procId, a.qty, a.fromStage, { note: 'Undo via Telegram', created_by_name: 'Telegram' });
      await clearFlow(chatId);
      return sendTelegram(token, chatId, `↩️ Undone — ${a.qty} ${a.unit} moved forward ${MATERIAL_STAGE_LABEL[a.toStage]} → ${MATERIAL_STAGE_LABEL[a.fromStage]} again for ${a.material}.`, MAIN_MENU);
    }
    if (a.kind === 'stock_commit') {
      const commits = await fetchOrderStockCommits(a.orderId);
      const c = commits.find((x) => String(x.id) === String(a.commitId));
      if (!c) return sendTelegram(token, chatId, 'That stock commit could not be found — it may already be undone.', MAIN_MENU);
      if (c.undone) return sendTelegram(token, chatId, 'That stock commit was already undone.', MAIN_MENU);
      await undoOrderStockCommit(c);
      await clearFlow(chatId);
      return sendTelegram(token, chatId, `↩️ Undone — ${a.total} piece(s) removed back out of inventory for ${a.orderNo}.`, MAIN_MENU);
    }
    if (a.kind === 'order_status') {
      await updateOrderStatus(a.orderId, a.prevStatus, 'Reverted via Telegram');
      await clearFlow(chatId);
      return sendTelegram(token, chatId, `↩️ Undone — ${a.orderNo} set back to ${a.prevStatus}.`, MAIN_MENU);
    }
  } catch (e: any) {
    return sendTelegram(token, chatId, `Could not undo: ${e.message}`, MAIN_MENU);
  }
  return sendTelegram(token, chatId, 'Nothing to undo right now.', MAIN_MENU);
};

// --- Deterministic data helpers (no AI) -------------------------------------

/** Gather every uploaded file in a style's tech pack. If `measureOnly`, keep
 *  only files from measurement / size-chart fields. */
const collectStyleAttachments = (style: Style, measureOnly = false): Attachment[] => {
  const out: Attachment[] = [];
  const seen = new Set<string>();
  const push = (a?: Attachment[]) => {
    (a || []).forEach((x) => {
      if (x && x.url && !seen.has(x.url)) {
        seen.add(x.url);
        out.push(x);
      }
    });
  };
  const isMeasureField = (name: string) => /measure|size\s*chart|measurement|spec\s*sheet/i.test(name);
  const tp: any = style.tech_pack || {};
  for (const catName of Object.keys(tp)) {
    for (const fieldName of Object.keys(tp[catName] || {})) {
      if (measureOnly && !isMeasureField(fieldName) && !isMeasureField(catName)) continue;
      const item = tp[catName][fieldName];
      if (!item) continue;
      push(item.attachments);
      (item.variants || []).forEach((v: any) => {
        push(v.attachments);
        (v.sizeVariants || []).forEach((sv: any) => push(sv.attachments));
      });
    }
  }
  return out;
};

/** Send a list of attachments to a chat, reporting any Telegram rejections. */
const deliverFiles = async (token: string, chatId: number | string, files: Attachment[], prefix: string) => {
  const failures: string[] = [];
  for (const f of files) {
    const caption = `${prefix} — ${f.name}`;
    let result =
      f.type === 'image'
        ? await sendTelegramPhoto(token, chatId, f.url, caption)
        : await sendTelegramDocument(token, chatId, f.url, caption);
    if (!result.ok && f.type === 'image') {
      result = await sendTelegramDocument(token, chatId, f.url, caption);
    }
    if (!result.ok) failures.push(`• ${f.name}: ${result.description || 'rejected by Telegram'}`);
  }
  if (failures.length) {
    await sendTelegram(
      token,
      chatId,
      `Could not send ${failures.length} file(s).\n${failures.join('\n')}\n\n` +
        `If this persists, make the Supabase "order-attachments" bucket public.`
    );
  }
};

// --- Telegram → Supabase file upload (button-driven attach to a style) ------

/** Download a Telegram file (photo/document) and return its bytes + a name. */
const downloadTelegramFile = async (
  token: string,
  fileId: string,
  fallbackName: string
): Promise<{ buf: Buffer; name: string; contentType: string } | null> => {
  try {
    const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const meta = await metaRes.json();
    const path = meta?.result?.file_path;
    if (!path) return null;
    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
    const buf = Buffer.from(await fileRes.arrayBuffer());
    const name = (path.split('/').pop() || fallbackName).replace(/[^\w.\-]/g, '_');
    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
    return { buf, name, contentType };
  } catch {
    return null;
  }
};

/** Upload raw bytes to the public order-attachments bucket and return its URL. */
const uploadToBucket = async (
  buf: Buffer,
  name: string,
  contentType: string
): Promise<string | null> => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const ext = name.includes('.') ? name.split('.').pop() : 'bin';
    const key = `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from('order-attachments')
      .upload(key, new Uint8Array(buf), { contentType, upsert: false });
    if (error) return null;
    const { data } = supabase.storage.from('order-attachments').getPublicUrl(key);
    return data.publicUrl || null;
  } catch {
    return null;
  }
};

/** Destinations a Telegram user can attach files to: poster gallery, a general
 *  bucket, then one entry per tech-pack category. */
const styleUploadDestinations = (style: Style): string[] => {
  const cats = Object.keys(style.tech_pack || {}).filter((k) => k !== POSTER_KEY && k !== CUSTOM_KEY);
  return ['__poster__', '__general__', ...cats];
};

const destinationLabel = (dest: string): string => {
  if (dest === '__auto__') return 'Auto (photos→Poster, files→General)';
  if (dest === '__poster__') return 'Poster gallery';
  if (dest === '__general__') return 'General files';
  return dest;
};

/** Attach an uploaded file to a style at the chosen destination. Poster images
 *  go to the poster gallery; everything else is stored as a custom tech-pack
 *  item keyed by the destination label (never touches forecast math). */
const attachFileToStyle = async (
  styleNumber: string,
  dest: string,
  att: Attachment
): Promise<boolean> => {
  const style = await fetchStyleByNumber(styleNumber.split(' - ')[0].trim());
  if (!style) return false;
  const tp: any = { ...(style.tech_pack || {}) };

  if (dest === '__poster__' && att.type === 'image') {
    const poster = tp[POSTER_KEY] && Array.isArray(tp[POSTER_KEY].images) ? tp[POSTER_KEY] : { images: [] };
    const images = [...poster.images, att];
    tp[POSTER_KEY] = { images, mainUrl: poster.mainUrl || images[0]?.url };
  } else {
    const bucketName = dest === '__general__' || dest === '__poster__' ? 'General files' : dest;
    const custom = tp[CUSTOM_KEY] && typeof tp[CUSTOM_KEY] === 'object' ? { ...tp[CUSTOM_KEY] } : {};
    const existing =
      custom[bucketName] && typeof custom[bucketName] === 'object'
        ? custom[bucketName]
        : { text: '', attachments: [] };
    custom[bucketName] = { ...existing, attachments: [...(existing.attachments || []), att] };
    tp[CUSTOM_KEY] = custom;
  }

  const { error } = await upsertStyle({ ...style, tech_pack: tp });
  return !error;
};

// --- Per-piece production requirements (quantity per piece) ------------------

const REQ_CATEGORY = 'Production Requirements';

type ParsedRequirement = {
  name: string;
  val: number;
  type: ConsumptionType;
  unit?: string;
  colors?: string[]; // empty/undefined => applies to the whole style
};

/** Pull a colour scope out of a phrase: "only for Red", "for Red, Blue",
 *  "colour: Black", "in White". Returns the colours plus the text with that
 *  clause removed so the quantity/name parse isn't confused by it. */
const extractColors = (raw: string): { colors: string[]; cleaned: string } => {
  let t = raw;
  const splitColors = (s: string) =>
    s
      .split(/[,/&]|\band\b/i)
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => c.replace(/\b\w/g, (ch) => ch.toUpperCase()))
      .slice(0, 12);
  const patterns = [
    /\bonly\s+for\s+colou?rs?\s+([a-z][a-z\s,/&]+?)\s*$/i,
    /\bfor\s+colou?rs?\s+([a-z][a-z\s,/&]+?)\s*$/i,
    /\bcolou?rs?\s*[:=]\s*([a-z][a-z\s,/&]+?)\s*$/i,
    /\bonly\s+for\s+([a-z][a-z\s,/&]+?)\s*$/i,
    /\bin\s+colou?r\s+([a-z][a-z\s,/&]+?)\s*$/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      return { colors: splitColors(m[1]), cleaned: t.slice(0, m.index).trim() };
    }
  }
  return { colors: [], cleaned: t };
};

/** Regex-first parse of a floor phrase like "Main fabric 1.2 meter",
 *  "Buttons 6 per piece", "1 cone for 50 pieces", "Lining 1.1 meter for Red".
 *  Returns null if no quantity can be found (caller may fall back to AI). */
const parseRequirementText = (raw: string): ParsedRequirement | null => {
  const colorRes = extractColors((raw || '').trim());
  const t = colorRes.cleaned.trim();
  if (!t) return null;
  const numMatch = t.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;

  // "1 cone for 50 pieces" / "makes 50 pcs" / "per 50 garments" => pcs_per_item.
  const perN = t.match(/(?:for|per|makes?|gives?|=)\s*(\d{2,})\s*(?:pcs?|pieces?|garments?)\b/i);
  let type: ConsumptionType = 'items_per_pc';
  let val = parseFloat(numMatch[1]);
  if (perN) {
    type = 'pcs_per_item';
    val = parseFloat(perN[1]);
  }

  const unit = (t.match(/\b(meters?|metres?|cm|cones?|buttons?|yards?|kgs?|grams?|rolls?|labels?|zips?|zippers?|m|g)\b/i) || [])[1];

  let name = t
    .replace(/(?:for|per|makes?|gives?|=)\s*\d{2,}\s*(?:pcs?|pieces?|garments?)\b/gi, ' ')
    .replace(/\d+(?:\.\d+)?/g, ' ')
    .replace(/\b(meters?|metres?|cm|cones?|buttons?|yards?|kgs?|grams?|rolls?|labels?|zips?|zippers?|pcs?|pieces?|piece|units?|per|each|of|m|g)\b/gi, ' ')
    .replace(/[:=\-_,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) name = unit ? unit.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Material';
  name = name.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);

  return { name, val, type, unit, colors: colorRes.colors };
};

/** AI fallback (text only, one tiny call) — used ONLY when the regex parse
 *  cannot read a quantity. Extracts {name, val, type, colors} from the phrase. */
const aiParseRequirement = async (raw: string): Promise<ParsedRequirement | null> => {
  if (!GEMINI_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const prompt =
      'Extract a per-piece material requirement from this short factory phrase ' +
      '(Tamil / English / Tanglish). Fields:\n' +
      '- name: the material/component name (e.g. "Main fabric", "Buttons").\n' +
      '- val: the numeric quantity.\n' +
      '- type: "items_per_pc" when it is amount of material per ONE garment ' +
      '(e.g. "1.2 meter per piece", "6 buttons"); "pcs_per_item" when one unit of ' +
      'material makes several garments (e.g. "1 cone for 50 pieces" => val 50).\n' +
      '- colors: array of colour names if the requirement is ONLY for specific ' +
      'colours (e.g. "only for Red" => ["Red"]); empty array if it applies to the whole style.\n' +
      'Reply ONLY JSON: {"name":"","val":0,"type":"items_per_pc","colors":[]}.\n\nPhrase: ' +
      raw;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rawJson = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join('').trim();
    const parsed = JSON.parse(rawJson);
    const val = Number(parsed.val);
    if (!val || !isFinite(val)) return null;
    const type: ConsumptionType = parsed.type === 'pcs_per_item' ? 'pcs_per_item' : 'items_per_pc';
    const name = String(parsed.name || 'Material').slice(0, 60) || 'Material';
    const colors = Array.isArray(parsed.colors)
      ? parsed.colors.map((c: any) => String(c).trim()).filter(Boolean).slice(0, 12)
      : [];
    return { name, val, type, colors };
  } catch {
    return null;
  }
};

/** Locator for a saved requirement so later photos can be attached to it. */
type RequirementRef = { styleNumber: string; fieldName: string; colorKey?: string };

/** Add (or update) a per-piece consumption requirement on a style. Stored as a
 *  real tech-pack field so the order forecast picks it up automatically. When
 *  `colors` are given it is saved as a colour-specific variant; otherwise it is
 *  a style-wide (global) requirement. Returns a ref to the saved item, plus the
 *  variant index when colour-scoped, or null on failure. */
const addProductionRequirement = async (
  styleNumber: string,
  req: ParsedRequirement,
  attachments: Attachment[] = []
): Promise<RequirementRef | null> => {
  const style = await fetchStyleByNumber(styleNumber.split(' - ')[0].trim());
  if (!style) return null;
  const tp: any = { ...(style.tech_pack || {}) };
  const cat = tp[REQ_CATEGORY] && typeof tp[REQ_CATEGORY] === 'object' ? { ...tp[REQ_CATEGORY] } : {};
  const existing =
    cat[req.name] && typeof cat[req.name] === 'object'
      ? cat[req.name]
      : { text: '', attachments: [] as Attachment[] };

  const colors = (req.colors || []).filter(Boolean);
  let ref: RequirementRef;

  if (colors.length) {
    // Colour-specific variant. Merge with an existing variant for the same colours.
    const colorKey = colors.join('/').toLowerCase();
    const variants: any[] = Array.isArray(existing.variants) ? [...existing.variants] : [];
    const idx = variants.findIndex(
      (v) => (v.colors || []).map((c: string) => c.toLowerCase()).sort().join('/') === [...colors].map((c) => c.toLowerCase()).sort().join('/')
    );
    const baseVariant = idx >= 0 ? variants[idx] : { colors, text: '', attachments: [] as Attachment[] };
    const merged = {
      ...baseVariant,
      colors,
      attachments: [...(baseVariant.attachments || []), ...attachments],
      consumption_type: req.type,
      consumption_val: req.val,
    };
    if (idx >= 0) variants[idx] = merged;
    else variants.push(merged);
    cat[req.name] = { ...existing, attachments: existing.attachments || [], variants };
    ref = { styleNumber: style.style_number, fieldName: req.name, colorKey };
  } else {
    // Style-wide (global) requirement.
    cat[req.name] = {
      ...existing,
      attachments: [...(existing.attachments || []), ...attachments],
      consumption_type: req.type,
      consumption_val: req.val,
    };
    ref = { styleNumber: style.style_number, fieldName: req.name };
  }

  tp[REQ_CATEGORY] = cat;
  const { error } = await upsertStyle({ ...style, tech_pack: tp });
  return error ? null : ref;
};

/** Attach a photo/file to a previously-saved requirement (item-level for a
 *  style-wide requirement, or to the matching colour variant). */
const attachPhotoToRequirement = async (ref: RequirementRef, att: Attachment): Promise<boolean> => {
  const style = await fetchStyleByNumber(ref.styleNumber.split(' - ')[0].trim());
  if (!style) return false;
  const tp: any = { ...(style.tech_pack || {}) };
  const cat = tp[REQ_CATEGORY] && typeof tp[REQ_CATEGORY] === 'object' ? { ...tp[REQ_CATEGORY] } : {};
  const item = cat[ref.fieldName];
  if (!item || typeof item !== 'object') return false;

  if (ref.colorKey && Array.isArray(item.variants)) {
    const variants = [...item.variants];
    const idx = variants.findIndex(
      (v: any) => (v.colors || []).map((c: string) => c.toLowerCase()).sort().join('/') === ref.colorKey!.split('/').sort().join('/')
    );
    if (idx < 0) return false;
    variants[idx] = { ...variants[idx], attachments: [...(variants[idx].attachments || []), att] };
    cat[ref.fieldName] = { ...item, variants };
  } else {
    cat[ref.fieldName] = { ...item, attachments: [...(item.attachments || []), att] };
  }
  tp[REQ_CATEGORY] = cat;
  const { error } = await upsertStyle({ ...style, tech_pack: tp });
  return !error;
};

/** Human-readable consumption summary, e.g. "1.2 meter per piece (Red/Blue)". */
const requirementSummary = (req: ParsedRequirement): string => {
  const base =
    req.type === 'items_per_pc'
      ? `${req.val}${req.unit ? ' ' + req.unit : ''} per piece`
      : `1 ${req.unit || 'unit'} per ${req.val} pieces`;
  const scope = req.colors && req.colors.length ? ` (only ${req.colors.join('/')})` : ' (whole style)';
  return base + scope;
};

// --- Procurement (material) helpers (button + voice driven) -----------------


/** All procurement lines linked to a given order id. */
const orderProcurements = async (orderId: string): Promise<MaterialProcurement[]> => {
  const all = await fetchProcurements();
  return all.filter((p) => p.order_id === orderId);
};

/** A one-line stage summary, e.g. "Req 0 · Ord 500 · Rec 1000 · Rel 500". */
const procStageLine = (p: MaterialProcurement): string =>
  MATERIAL_STAGE_ORDER.map((s) => `${MATERIAL_STAGE_LABEL[s].slice(0, 3)} ${procurementStageQty(p, s)}`).join(' · ');

/** Inline buttons to advance a procurement: one per next stage that has stock
 *  waiting at the previous stage. */
const procAdvanceMarkup = (p: MaterialProcurement) => {
  const rows: any[] = [];
  for (const to of [MaterialStage.ORDERED, MaterialStage.RECEIVED, MaterialStage.RELEASED]) {
    const from = prevMaterialStage(to)!;
    const avail = procurementStageQty(p, from);
    if (avail > 0) {
      rows.push([{ text: `▶️ ${avail} → ${MATERIAL_STAGE_LABEL[to]}`, callback_data: `padv:${p.id}:${to}` }]);
    }
  }
  // Correction buttons: pull a quantity back a stage if it was advanced by mistake.
  for (const from of [MaterialStage.ORDERED, MaterialStage.RECEIVED, MaterialStage.RELEASED]) {
    const here = procurementStageQty(p, from);
    if (here > 0) {
      const back = prevMaterialStage(from)!;
      rows.push([{ text: `↩️ Fix: ${here} ${MATERIAL_STAGE_LABEL[from]} → ${MATERIAL_STAGE_LABEL[back]}`, callback_data: `pback:${p.id}:${from}` }]);
    }
  }
  rows.push([{ text: '⬅️ Menu', callback_data: 'menu' }]);
  return { inline_keyboard: rows };
};

const sendProcurementCard = async (token: string, chatId: number | string, p: MaterialProcurement) => {
  const text =
    `🧵 ${p.material_name}\n` +
    `Style: ${p.style_number || '—'}\n` +
    `Total: ${p.total_quantity} ${p.unit}\n` +
    `${procStageLine(p)}` +
    (p.invoice_no ? `\nInvoice: ${p.invoice_no}` : '');
  await sendTelegram(token, chatId, text, procAdvanceMarkup(p));
};

/** A one-tap list of every material line that still needs attention. The
 *  materials desk never has to remember order numbers — just tap a line. */
const runMaterialsToAction = async (token: string, chatId: number | string) => {
  const all = await fetchProcurements().catch(() => [] as MaterialProcurement[]);
  const needs = (p: MaterialProcurement) =>
    procurementStageQty(p, MaterialStage.REQUESTED) > 0 ||
    procurementStageQty(p, MaterialStage.ORDERED) > 0 ||
    procurementStageQty(p, MaterialStage.RECEIVED) > 0;
  const pending = all.filter(needs);
  if (pending.length === 0) {
    return sendTelegram(token, chatId, '🎉 All caught up — nothing waiting to be ordered, received or released.', MAIN_MENU);
  }
  const tag = (p: MaterialProcurement) => {
    if (procurementStageQty(p, MaterialStage.REQUESTED) > 0) return '🟠 to order';
    if (procurementStageQty(p, MaterialStage.ORDERED) > 0) return '🔵 awaiting receipt';
    return '🟢 to release';
  };
  const rows = pending.slice(0, 20).map((p) => [
    {
      text: `${tag(p)} · ${p.material_name}${p.style_number ? ` (${p.style_number})` : ''}`.slice(0, 60),
      callback_data: `psel:${p.id}`,
    },
  ]);
  rows.push([{ text: '⬅️ Menu', callback_data: 'menu' }]);
  await sendTelegram(
    token,
    chatId,
    `📥 ${pending.length} material line(s) need attention.\nTap one to order, receive, release — or fix a mistake:`,
    { inline_keyboard: rows }
  );
};

/** Apply a procurement advance (full available qty at the previous stage). */
const doAdvanceProcurement = async (
  token: string,
  chatId: number | string,
  procId: string,
  toStage: MaterialStage,
  invoiceNo?: string
) => {
  const all = await fetchProcurements();
  const p = all.find((x) => x.id === procId);
  if (!p) return sendTelegram(token, chatId, 'That material line no longer exists.', MAIN_MENU);
  const from = prevMaterialStage(toStage);
  if (!from) return sendTelegram(token, chatId, `Cannot advance into ${toStage}.`, MAIN_MENU);
  const qty = procurementStageQty(p, from);
  if (qty <= 0) {
    return sendTelegram(token, chatId, `Nothing is at the ${MATERIAL_STAGE_LABEL[from]} stage to move.`, MAIN_MENU);
  }
  try {
    const updated = await advanceProcurement(p.id, qty, toStage, {
      invoice_no: invoiceNo || null,
      note: 'Updated via Telegram',
      created_by_name: 'Telegram',
    });
    const fromStage = prevMaterialStage(toStage)!;
    await recordLastAction(chatId, {
      kind: 'material_advance', procId: updated.id, material: updated.material_name,
      unit: updated.unit, fromStage, toStage, qty, at: new Date().toISOString(),
    });
    await sendTelegram(
      token,
      chatId,
      `✅ ${updated.material_name}: ${qty} ${updated.unit} → ${MATERIAL_STAGE_LABEL[toStage]}.\nWrong tap? Tap Undo.`,
      undoMarkup()
    );
    await sendProcurementCard(token, chatId, updated);
  } catch (e: any) {
    await sendTelegram(token, chatId, `Could not update: ${e.message}`, MAIN_MENU);
  }
};

/** Apply a correction: pull the full quantity at a stage back to the previous one. */
const doRegressProcurement = async (
  token: string,
  chatId: number | string,
  procId: string,
  fromStage: MaterialStage
) => {
  const all = await fetchProcurements();
  const p = all.find((x) => x.id === procId);
  if (!p) return sendTelegram(token, chatId, 'That material line no longer exists.', MAIN_MENU);
  const back = prevMaterialStage(fromStage);
  if (!back) return sendTelegram(token, chatId, `${MATERIAL_STAGE_LABEL[fromStage]} cannot be stepped back.`, MAIN_MENU);
  const qty = procurementStageQty(p, fromStage);
  if (qty <= 0) {
    return sendTelegram(token, chatId, `Nothing is at the ${MATERIAL_STAGE_LABEL[fromStage]} stage to pull back.`, MAIN_MENU);
  }
  try {
    const updated = await regressProcurement(p.id, qty, fromStage, {
      note: 'Correction via Telegram',
      created_by_name: 'Telegram',
    });
    await recordLastAction(chatId, {
      kind: 'material_regress', procId: updated.id, material: updated.material_name,
      unit: updated.unit, fromStage, toStage: back, qty, at: new Date().toISOString(),
    });
    await sendTelegram(
      token,
      chatId,
      `↩️ Corrected: ${updated.material_name} ${qty} ${updated.unit} ${MATERIAL_STAGE_LABEL[fromStage]} → ${MATERIAL_STAGE_LABEL[back]}.`,
      undoMarkup()
    );
    await sendProcurementCard(token, chatId, updated);
  } catch (e: any) {
    await sendTelegram(token, chatId, `Could not correct: ${e.message}`, MAIN_MENU);
  }
};

/** Find an order from a spoken/typed reference (matches the serial digits). */
const findOrder = (orders: Order[], ref: string): Order | undefined => {
  const digits = (ref || '').replace(/\D/g, '');
  if (!digits) return undefined;
  return orders.find((o) => {
    const formatted = formatOrderNumber(o).replace(/\D/g, '');
    const raw = (o.order_no || '').replace(/\D/g, '');
    return formatted.endsWith(digits) || raw === digits || raw.endsWith(digits);
  });
};

// Map a floor message to a production-order status. KEY RULE: when a specific
// production stage is named (cutting / stitching / qc / packing), that stage
// wins even if the message also contains a generic word like "completed" or
// "done". The bare word "completed/done/dispatched" only maps to COMPLETED when
// NO specific stage is mentioned. This makes phrases work intuitively:
//   "stitching completed" -> IN_PROGRESS (stitching is the in-progress stage)
//   "qc done" / "qc passed"-> QC_APPROVED
//   "packing completed"    -> PACKED
//   "order completed/dispatched/delivered" -> COMPLETED
const COMPLETION_RE = /complete|completed|finish|finished|\bdone\b|over\b|mudin|mudich|aach|aagid|aayid/i;

const mapStatusWord = (text: string): OrderStatus | undefined => {
  const t = text || '';
  const dispatch = /dispatch|deliver|shipp?ed|shipment|courier|hand.?over|handed.?over/i.test(t);
  const hasPack = /pack(ing|ed)?/i.test(t);
  const hasQc = /\bq\.?c\b|checking|inspection|quality/i.test(t);
  const qcPass = /pass|approv|qc.?ok|cleared|\bok\b/i.test(t);
  const hasProd =
    /cutting|cut\b|stitch|sew|tailor|production|running|in.?progress|\bwip\b|\bstart|\bbegin/i.test(t);
  const hasAssign = /assign/i.test(t);
  const completed = COMPLETION_RE.test(t);

  // Most-advanced / most-specific stage wins.
  if (dispatch) return OrderStatus.COMPLETED;
  if (hasPack) return OrderStatus.PACKED;
  if (hasQc) return qcPass || completed ? OrderStatus.QC_APPROVED : OrderStatus.QC;
  if (qcPass) return OrderStatus.QC_APPROVED;
  if (hasProd) return OrderStatus.IN_PROGRESS;
  if (hasAssign) return OrderStatus.ASSIGNED;
  // Generic completion with no specific stage named.
  if (completed) return OrderStatus.COMPLETED;
  return undefined;
};

const MATERIAL_STAGE_WORDS: { re: RegExp; stage: MaterialStage }[] = [
  { re: /order(ed)?|purchase|\bpo\b|bought|placed/i, stage: MaterialStage.ORDERED },
  { re: /receiv|arriv|got|delivered|came|reach/i, stage: MaterialStage.RECEIVED },
  { re: /releas|issue|floor|given|handed|consum/i, stage: MaterialStage.RELEASED },
  { re: /request|need|raise|require/i, stage: MaterialStage.REQUESTED },
];

const mapMaterialStageWord = (text: string): MaterialStage | undefined =>
  MATERIAL_STAGE_WORDS.find((s) => s.re.test(text))?.stage;

/** Heuristic: does the message look like a material/procurement update rather
 *  than a production-order status change? */
const looksLikeMaterial = (text: string): boolean =>
  /material|procure|thread|fabric|cloth|button|zip(per)?|elastic|label|trim|cone|yarn|dyeing|accessor|invoice|stock|raw\s*material|cotton|lining|tape|velcro/i.test(
    text
  );

/** Finishing / shop-floor sub-processes that are NOT order statuses. When one
 *  of these is mentioned the message is a progress NOTE for the timeline, even
 *  if it also contains a generic word like "done" or "completed". */
const SUBPROCESS_WORDS =
  /iron(ing)?|press(ing)?|wash(ing)?|embroider|print(ing)?|fus(ing)?|kaja|button.?hole|steam|mend(ing)?|bartack|overlock|hemming|tailor|finishing|loading|sticker|tag(ging)?|folding|measure(ment)?|sampl(e|ing)/i;

export type ParsedUpdate = {
  kind: 'order' | 'material';
  order_number?: string;
  material?: string;
  status?: OrderStatus;
  stage?: MaterialStage;
  invoice?: string;
};

/** Pull an invoice number out of a spoken/typed message, e.g.
 *  "...with invoice number INV-2231" -> "INV-2231". */
const extractInvoiceNo = (text: string): string | undefined => {
  const m = text.match(/invoice\s*(?:number|no\.?|num|#)?\s*(?:is|:|-|=)?\s*([A-Za-z0-9][A-Za-z0-9\-\/]*)/i);
  const v = (m?.[1] || '').trim();
  return v && !/^(number|no|num|is)$/i.test(v) ? v : undefined;
};

/** Minimal AI: turn a voice/text transcript into a structured update. ONE small
 *  JSON call — no agent loop, no tool registry, almost no tokens. Classifies
 *  between a production-order status change and a material/procurement stage
 *  move, and extracts the references. Falls back to regex when no AI key. */
const parseUpdate = async (text: string): Promise<ParsedUpdate> => {
  const materialFirst = looksLikeMaterial(text);
  const regexResult: ParsedUpdate = {
    kind: materialFirst ? 'material' : 'order',
    order_number: (text.match(/\d{2,}/) || [])[0],
    material: undefined,
    status: mapStatusWord(text),
    stage: mapMaterialStageWord(text),
    invoice: extractInvoiceNo(text),
  };
  if (!GEMINI_KEY) return regexResult;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const prompt =
      'You parse short factory messages (Tamil / English / Tanglish). Decide if it is a ' +
      'production ORDER status update or a MATERIAL/procurement stage update.\n' +
      'ORDER statuses: ASSIGNED, IN_PROGRESS, QC, QC_APPROVED, PACKED, COMPLETED.\n' +
      'IMPORTANT: if a specific production stage is named, that stage WINS even if the message ' +
      'also says "completed/done/over":\n' +
      '  cutting/stitching/sewing/tailoring/production = IN_PROGRESS (e.g. "stitching completed" = IN_PROGRESS),\n' +
      '  checking/inspection = QC; qc passed/approved/ok/qc done = QC_APPROVED,\n' +
      '  packing/packed (e.g. "packing completed") = PACKED.\n' +
      'Use COMPLETED ONLY when the WHOLE order is finished/dispatched/delivered/shipped with no ' +
      'specific stage named (e.g. "order 1004 done", "dispatched").\n' +
      'MATERIAL stages: REQUESTED, ORDERED, RECEIVED, RELEASED ' +
      '(ordered/purchased/PO=ORDERED, received/arrived/got=RECEIVED, issued/released to floor=RELEASED, needed/raise=REQUESTED).\n' +
      'order_number = the order serial digits. material = the material name words if mentioned (e.g. "black thread").\n' +
      'invoice = the invoice/bill number if one is spoken (e.g. "invoice number INV-2231" -> "INV-2231"), else "".\n' +
      'Reply ONLY JSON: {"kind":"order|material","order_number":"","material":"","status":"","stage":"","invoice":""}. ' +
      'Use "" for anything unknown.\n\nMessage: ' +
      text;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return regexResult;
    const data = await res.json();
    const raw = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join('').trim();
    const parsed = JSON.parse(raw);
    const status = String(parsed.status || '').toUpperCase();
    const stage = String(parsed.stage || '').toUpperCase();
    const kind: 'order' | 'material' = parsed.kind === 'material' ? 'material' : parsed.kind === 'order' ? 'order' : regexResult.kind;
    return {
      kind,
      order_number: parsed.order_number ? String(parsed.order_number) : regexResult.order_number,
      material: parsed.material ? String(parsed.material) : regexResult.material,
      status: (Object.values(OrderStatus) as string[]).includes(status) ? (status as OrderStatus) : regexResult.status,
      stage: (Object.values(MaterialStage) as string[]).includes(stage) ? (stage as MaterialStage) : regexResult.stage,
      invoice: parsed.invoice ? String(parsed.invoice).trim() : regexResult.invoice,
    };
  } catch {
    return regexResult;
  }
};

const isPoLaunchText = (text: string): boolean => {
  const normalized = (text || '').trim();
  if (!normalized) return false;
  return /\b(?:launch|create|raise|make|send|build|generate|open|prepare|draft)\b.*\b(?:po|purchase order)\b/i.test(normalized) ||
    /\b(?:po|purchase order)\b.*\b(?:launch|create|raise|make|send|build|generate|open|prepare|draft)\b/i.test(normalized);
};

const wantsPoForward = (text?: string): boolean => {\n  const normalized = (text || ).trim();\n  if (!normalized) return false;\n  return /\b(?:forward|commit|complete|final(?:ise|ize)|send to accounts|send to inventory|dispatch|approve|release)\b/i.test(normalized);\n};\n\nconst parseBuyerName = (text: string): string | undefined => {
  const lines = (text || '').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/\b(?:buyer|customer|party|to)\b\s*[:=-]\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  const fallback = text.match(/\b(?:for|to)\b\s+([A-Za-z][A-Za-z0-9 &'\-]{2,})/i);
  return fallback ? fallback[1].trim() : undefined;
};

const tryParseJsonFromString = (raw: string): any | null => {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  const candidate = raw.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

const parsePoMarkdownTable = (text: string): SalesOrderLine[] => {
  const rows = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tableRows = rows.filter((line) => line.includes('|'));
  if (tableRows.length < 2) return [];

  const header = tableRows[0]
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
  const dataRows = tableRows.slice(1).filter((line) => !/^[\s|:-]+$/.test(line));
  const styleIndex = header.findIndex((h) => /style|item|code/i.test(h));
  const colorIndex = header.findIndex((h) => /color|colour/i.test(h));
  const totalIndex = header.findIndex((h) => /total|qty|quantity/i.test(h));
  const rateIndex = header.findIndex((h) => /rate|price/i.test(h));
  const amountIndex = header.findIndex((h) => /amount|amt/i.test(h));
  const sizeIndexes = header
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /^[A-Za-z0-9\/]+$/.test(h) && !/style|item|code|color|colour|total|qty|quantity|rate|price|amount|amt/i.test(h))
    .map(({ i }) => i);

  const lines: SalesOrderLine[] = [];
  for (const row of dataRows) {
    const cells = row.split('|').map((cell) => cell.trim());
    const style = styleIndex >= 0 ? cells[styleIndex] || '' : '';
    if (!style) continue;
    const sizes: Record<string, number> = {};
    let total = 0;
    for (const idx of sizeIndexes) {
      const label = header[idx];
      const value = Number(cells[idx] || 0);
      if (value > 0) {
        const key = normalizeSize(label) || label;
        sizes[key] = value;
        total += value;
      }
    }
    if (total === 0 && totalIndex >= 0) {
      total = Number(cells[totalIndex] || 0) || 0;
    }
    if (!total) continue;
    const rate = rateIndex >= 0 ? Number(cells[rateIndex] || 0) || undefined : undefined;
    const amount = amountIndex >= 0 ? Number(cells[amountIndex] || 0) || undefined : undefined;
    const color = colorIndex >= 0 ? (cells[colorIndex] || undefined) : undefined;
    lines.push({ style_number: style, sizes, total, rate, amount, color });
  }
  return lines;
};

const parseOnePoLineText = (line: string): SalesOrderLine | null => {
  const raw = line.trim();
  if (!raw || /^(total|subtotal|grand total|note)\b/i.test(raw)) return null;
  const styleMatch = raw.match(/^(?:style\s*[:=-]\s*)?([A-Za-z0-9][A-Za-z0-9\-\/]+)\b(.*)$/i);
  let style = styleMatch ? styleMatch[1].trim() : '';
  let rest = styleMatch ? styleMatch[2].trim() : raw;
  if (!style) {
    const firstToken = raw.split(/\s+/)[0];
    if (firstToken && /[A-Za-z]/.test(firstToken)) {
      style = firstToken;
      rest = raw.slice(firstToken.length).trim();
    }
  }
  if (!style) return null;

  const sizes: Record<string, number> = {};
  let total = 0;
  for (const m of rest.matchAll(/([A-Za-z0-9\/]+)\s*[:=xX]\s*(\d+)/g)) {
    const key = normalizeSize(m[1]) || m[1].toUpperCase();
    const qty = Number(m[2]) || 0;
    if (qty > 0) {
      sizes[key] = (sizes[key] || 0) + qty;
      total += qty;
    }
  }
  const rateMatch = rest.match(/(?:@|rate)\s*[:=]?\s*([\d.]+)/i);
  const rate = rateMatch ? Number(rateMatch[1]) || undefined : undefined;
  if (total === 0) {
    const totalMatch = rest.match(/(?:total|qty|quantity|pcs|pieces)?\s*[:=]?\s*(\d+)\b/i);
    if (totalMatch) total = Number(totalMatch[1]) || 0;
  }
  if (total <= 0) return null;
  const amount = rate ? Math.round(total * rate * 100) / 100 : undefined;
  const colorMatch = rest.match(/(?:color|colour)\s*[:=]\s*([A-Za-z0-9 &-]+)/i);
  const color = colorMatch ? colorMatch[1].trim() : undefined;
  return { style_number: style, sizes, total, rate, amount, color };
};

const parsePoFromPlainText = (text: string): { buyer_name?: string; lines: SalesOrderLine[]; note?: string } => {
  const raw = (text || '').trim();
  const buyer_name = parseBuyerName(raw);
  const lines: SalesOrderLine[] = [];
  const markdownLines = parsePoMarkdownTable(raw);
  if (markdownLines.length) {
    return { buyer_name, lines: markdownLines };
  }

  const parts = raw
    .split(/\r?\n|;|\|\||\t/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\s*(buyer|customer|for|purchase order)/i.test(line));
  for (const part of parts) {
    const line = parseOnePoLineText(part);
    if (line) lines.push(line);
  }
  return { buyer_name, lines, note: undefined };
};

const parsePoWithGemini = async (text: string): Promise<{ buyer_name?: string; lines: SalesOrderLine[]; note?: string }> => {
  if (!GEMINI_KEY) return { lines: [] };
  try {
    const prompt =
      'Extract a purchase order from the input. Reply ONLY with JSON containing: ' +
      '{"buyer_name":"","lines":[{"style_number":"","sizes":{},"total":0,"rate":0,"amount":0,"color":""}],"note":""}. ' +
      'Sizes should be keys in the sizes object and values should be quantities. Use exact style numbers. Do not add any extra text.\n\nInput:\n' +
      text;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return { lines: [] };
    const data = await res.json();
    const raw = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join('').trim();
    const parsed = tryParseJsonFromString(raw);
    if (!parsed || !Array.isArray(parsed.lines)) return { lines: [] };
    const lines = parsed.lines
      .map((l: any) => {
        const sizes: Record<string, number> = {};
        const rawSizes = l.sizes || {};
        Object.keys(rawSizes || {}).forEach((k) => {
          const qty = Number(rawSizes[k]) || 0;
          if (qty > 0) sizes[normalizeSize(k) || k] = qty;
        });
        const total = Number(l.total) || Object.values(sizes).reduce((a, v) => a + v, 0);
        if (!l.style_number || total <= 0) return null;
        const rate = Number(l.rate) || undefined;
        const amount = Number(l.amount) || (rate ? Math.round(total * rate * 100) / 100 : undefined);
        return {
          style_number: String(l.style_number).trim(),
          sizes,
          total,
          rate,
          amount,
          color: l.color ? String(l.color).trim() : undefined,
        } as SalesOrderLine;
      })
      .filter((l: SalesOrderLine | null): l is SalesOrderLine => !!l);
    return { buyer_name: parsed.buyer_name ? String(parsed.buyer_name).trim() : undefined, lines, note: parsed.note ? String(parsed.note).trim() : undefined };
  } catch {
    return { lines: [] };
  }
};

const parsePoFromText = async (text: string): Promise<{ buyer_name?: string; lines: SalesOrderLine[]; note?: string }> => {
  const fallback = parsePoFromPlainText(text);
  if (!GEMINI_KEY) return fallback;
  const aiResult = await parsePoWithGemini(text);
  return aiResult.lines.length ? aiResult : fallback;
};

const extractPoFromImage = async (
  buf: Buffer,
  mime: string,
  caption?: string
): Promise<{ buyer_name?: string; lines: SalesOrderLine[]; note?: string } | null> => {
  if (!GEMINI_KEY) return null;
  try {
    const prompt =
      'Extract a purchase order from the attached image and caption. Respond ONLY with JSON in this exact shape: ' +
      '{"buyer_name":"","lines":[{"style_number":"","sizes":{},"total":0,"rate":0,"amount":0,"color":""}],"note":""}. ' +
      'The image contains a table or list of PO line items. Use any buyer information from the caption or the image. Do not add any extra text.\n\nCaption:\n' +
      (caption || '') +
      '\n\nImage:';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mime || 'image/jpeg', data: buf.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join('').trim();
    const parsed = tryParseJsonFromString(raw);
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    const lines = parsed.lines
      .map((l: any) => {
        const sizes: Record<string, number> = {};
        const rawSizes = l.sizes || {};
        Object.keys(rawSizes || {}).forEach((k) => {
          const qty = Number(rawSizes[k]) || 0;
          if (qty > 0) sizes[normalizeSize(k) || k] = qty;
        });
        const total = Number(l.total) || Object.values(sizes).reduce((a, v) => a + v, 0);
        if (!l.style_number || total <= 0) return null;
        const rate = Number(l.rate) || undefined;
        const amount = Number(l.amount) || (rate ? Math.round(total * rate * 100) / 100 : undefined);
        return {
          style_number: String(l.style_number).trim(),
          sizes,
          total,
          rate,
          amount,
          color: l.color ? String(l.color).trim() : undefined,
        } as SalesOrderLine;
      })
      .filter((l: SalesOrderLine | null): l is SalesOrderLine => !!l);
    return { buyer_name: parsed.buyer_name ? String(parsed.buyer_name).trim() : undefined, lines, note: parsed.note ? String(parsed.note).trim() : undefined };
  } catch {
    return null;
  }
};

const buildPoSizeFormat = (lines: SalesOrderLine[]): { size_format: 'standard' | 'numeric'; size_labels: string[] } => {
  const allLabels = Array.from(new Set(lines.flatMap((line) => Object.keys(line.sizes || {}))));
  const numericOnly = allLabels.length && allLabels.every((label) => /^\d+$/.test(label));
  return {
    size_format: numericOnly ? 'numeric' : 'standard',
    size_labels: numericOnly ? Array.from(new Set(allLabels)) : Array.from(new Set(allLabels.map((label) => normalizeSize(label) || label))),
  };
};

const createDraftPoFromParsed = async (
  token: string,
  chatId: number | string,
  parsed: { buyer_name?: string; lines: SalesOrderLine[]; note?: string },
  caption?: string,
  forward = false
): Promise<boolean> => {
  if (!parsed.lines.length) return false;
  const buyer_name = parsed.buyer_name?.trim() || 'Walk-in';
  const poDate = new Date().toISOString().slice(0, 10);
  const { size_format, size_labels } = buildPoSizeFormat(parsed.lines);
  try {
    const so = await createSalesOrder({
      po_number: 'auto',
      po_date: poDate,
      buyer_name,
      size_format,
      size_labels,
      lines: parsed.lines,
      note: parsed.note || caption || undefined,
      created_by_name: 'Telegram',
    });
    if (forward) {
      await forwardSalesOrder(so.id);
    }
    await sendTelegram(
      token,
      chatId,
      forward
        ? `✅ PO ${so.po_number} created and forwarded to Inventory & Accounts for ${so.buyer_name} (${so.total_qty} pcs).`
        : `✅ Draft PO ${so.po_number} created for ${so.buyer_name} (${so.total_qty} pcs). Use the menu to view or forward it after verification.`
    );
    await sendPoPdf(token, chatId, forward ? { ...so, status: 'FORWARDED' } : so, forward ? 'PO forwarded' : 'Draft PO created');
    return true;
  } catch (e: any) {
    await sendTelegram(token, chatId, `Could not create the PO: ${e?.message || 'unknown error'}.`);
    return true;
  }
};

/** Rewrite a short voice/text floor update as one concise English sentence
 *  suitable for an order activity log. Falls back to the raw transcript when no
 *  AI key is configured or the call fails. */
const toEnglishNote = async (text: string): Promise<string> => {
  const clean = (text || '').trim();
  if (!clean || !GEMINI_KEY) return clean;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const prompt =
      'Rewrite this short factory-floor update (Tamil / English / Tanglish) as ONE concise ' +
      'English sentence for an order activity log. Keep all numbers and quantities. Do not ' +
      'add or invent any information. Reply with only the sentence.\n\nMessage: ' +
      clean;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!res.ok) return clean;
    const data = await res.json();
    const out = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text)
      .join('')
      .trim();
    return out ? out.slice(0, 400) : clean;
  } catch {
    return clean;
  }
};

/** Free-text assistant: answer a typed question using a compact snapshot of the
 *  factory data (orders, materials, stock, sales). One Gemini call, no tools. */
const aiAssistantReply = async (token: string, chatId: number | string, question: string) => {
  if (!GEMINI_KEY) {
    await sendTelegram(
      token,
      chatId,
      "I can't answer free-text questions yet — no AI key is configured. Tap an action instead:",
      MAIN_MENU
    );
    return;
  }
  await sendTelegram(token, chatId, '🤖 Thinking…');
  try {
    const [orders, procs, stock, sales] = await Promise.all([
      fetchOrders().catch(() => [] as any[]),
      fetchProcurements().catch(() => [] as any[]),
      fetchStockLevels().catch(() => [] as any[]),
      fetchSalesOrders().catch(() => [] as any[]),
    ]);

    const orderCtx = orders
      .slice(0, 40)
      .map((o: any) => `#${o.order_no} style:${(o.style_number || '').split(' - ')[0]} qty:${o.quantity} status:${o.status}`)
      .join('\n');
    const procCtx = procs
      .slice(0, 30)
      .map((p: any) => `${p.material_name} (style ${p.style_number || '-'}) total:${p.total_quantity} req:${p.qty_requested} ord:${p.qty_ordered} rcv:${p.qty_received} rel:${p.qty_released}`)
      .join('\n');
    const stockByStyle: Record<string, number> = {};
    for (const r of stock as any[]) stockByStyle[r.style_number] = (stockByStyle[r.style_number] || 0) + (r.quantity || 0);
    const stockCtx = Object.entries(stockByStyle)
      .slice(0, 40)
      .map(([s, q]) => `${s}: ${q}`)
      .join('\n');
    const salesCtx = (sales as any[])
      .slice(0, 30)
      .map((s) => `${s.po_number} buyer:${s.buyer_name} qty:${s.total_qty} status:${s.status}`)
      .join('\n');

    const context =
      `ORDERS:\n${orderCtx || '(none)'}\n\nMATERIALS:\n${procCtx || '(none)'}\n\n` +
      `INVENTORY (style: units):\n${stockCtx || '(none)'}\n\nSALES POs:\n${salesCtx || '(none)'}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const prompt =
      "You are the Tintura factory assistant on Telegram. Answer the user's question briefly " +
      '(Tamil / English / Tanglish ok) using ONLY the data snapshot below. If the answer is not in ' +
      "the data, say you don't have that info and suggest tapping the menu. Keep it short.\n\n" +
      `DATA SNAPSHOT:\n${context.slice(0, 6000)}\n\nQUESTION: ${question}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
    });
    const data = await res.json().catch(() => ({}));
    const answer = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text)
      .filter(Boolean)
      .join('')
      .trim();
    await sendTelegram(token, chatId, answer || "I couldn't find an answer in the current data.", MAIN_MENU);
  } catch (e: any) {
    await sendTelegram(token, chatId, `Sorry, I couldn't answer that: ${e?.message || 'error'}.`, MAIN_MENU);
  }
};

// --- Tech-pack PDF generation (server-side, pdf-lib) ------------------------
/** Fetch an image URL and embed it into the doc if it is PNG or JPEG.
 *  pdf-lib only supports PNG/JPG, so other formats (webp/gif) are skipped. */
const embedImageFromUrl = async (pdf: PDFDocument, url: string) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 4) return null;
    // PNG magic: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return await pdf.embedPng(bytes);
    }
    // JPEG magic: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return await pdf.embedJpg(bytes);
    }
    return null;
  } catch {
    return null;
  }
};

const CONSUMPTION_LABEL = (t?: string, v?: number): string => {
  if (!t || v === undefined || v === null) return '';
  return t === 'items_per_pc' ? `${v} per pc` : `1 per ${v} pcs`;
};

/** Build a clean single tech-pack PDF for a style (header, specs, poster,
 *  every tech-pack field + variants, custom items). Returns PDF bytes. */
const generateTechPackPdf = async (style: Style): Promise<Buffer> => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const A4 = { w: 595.28, h: 841.89 };
  const margin = 40;
  const dark = rgb(0.12, 0.16, 0.23);
  const indigo = rgb(0.31, 0.27, 0.9);
  const grey = rgb(0.42, 0.45, 0.5);
  const line = rgb(0.85, 0.87, 0.9);

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - margin;

  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - margin;
  };
  const ensure = (need: number) => {
    if (y - need < margin) newPage();
  };

  // word-wrap a string to a given width
  const wrap = (text: string, f: PDFFont, size: number, maxW: number): string[] => {
    const out: string[] = [];
    for (const raw of String(text).split('\n')) {
      const words = raw.split(/\s+/).filter(Boolean);
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) > maxW && cur) {
          out.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      out.push(cur);
    }
    return out.length ? out : [''];
  };

  const drawText = (text: string, f: PDFFont, size: number, color = dark, indent = 0) => {
    const maxW = A4.w - margin * 2 - indent;
    for (const ln of wrap(text, f, size, maxW)) {
      ensure(size + 4);
      page.drawText(ln, { x: margin + indent, y: y - size, size, font: f, color });
      y -= size + 4;
    }
  };

  // ---- Header band ----
  page.drawRectangle({ x: 0, y: A4.h - 70, width: A4.w, height: 70, color: dark });
  page.drawText('TECH PACK', { x: margin, y: A4.h - 34, size: 11, font: bold, color: rgb(0.7, 0.74, 1) });
  page.drawText(style.style_number || 'Style', { x: margin, y: A4.h - 58, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText(new Date().toLocaleDateString(), {
    x: A4.w - margin - 90,
    y: A4.h - 34,
    size: 9,
    font,
    color: rgb(0.7, 0.74, 0.85),
  });
  y = A4.h - 90;

  if (style.style_text) drawText(style.style_text, font, 11, grey);
  y -= 4;

  // ---- Meta grid ----
  const meta: [string, string][] = [
    ['Category', style.category || '—'],
    ['Packing', style.packing_type || '—'],
    ['Pcs / Box', String(style.pcs_per_box ?? '—')],
    ['Garment', style.garment_type || '—'],
    ['Demographic', style.demographic || '—'],
    ['Size Type', style.size_type || '—'],
  ];
  for (const [k, v] of meta) {
    ensure(14);
    page.drawText(`${k}:`, { x: margin, y: y - 10, size: 9, font: bold, color: grey });
    page.drawText(v, { x: margin + 80, y: y - 10, size: 9, font, color: dark });
    y -= 15;
  }
  y -= 4;

  const colors = (style.available_colors || []).filter(Boolean).join(', ') || '—';
  const sizes = (style.available_sizes || []).join(', ') || '—';
  drawText(`Colors: ${colors}`, font, 10, dark);
  drawText(`Sizes: ${sizes}`, font, 10, dark);
  y -= 6;

  // ---- Poster main image ----
  const poster = getStylePoster(style);
  const mainUrl = poster.mainUrl || poster.images[0]?.url;
  if (mainUrl) {
    const img = await embedImageFromUrl(pdf, mainUrl);
    if (img) {
      const maxW = 200;
      const maxH = 220;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      ensure(h + 10);
      page.drawImage(img, { x: margin, y: y - h, width: w, height: h });
      y -= h + 12;
    }
  }

  // section header helper
  const section = (title: string) => {
    ensure(28);
    y -= 6;
    page.drawRectangle({ x: margin, y: y - 18, width: A4.w - margin * 2, height: 18, color: rgb(0.95, 0.96, 0.98) });
    page.drawText(title.toUpperCase(), { x: margin + 6, y: y - 13, size: 9, font: bold, color: indigo });
    y -= 24;
  };

  // ---- Tech-pack categories ----
  const tp: any = style.tech_pack || {};
  for (const catName of Object.keys(tp)) {
    if (catName === POSTER_KEY || catName === CUSTOM_KEY) continue;
    const fields = tp[catName] || {};
    if (!Object.keys(fields).length) continue;
    section(catName);
    for (const fieldName of Object.keys(fields)) {
      const item = fields[fieldName];
      if (!item) continue;
      drawText(fieldName, bold, 11, dark);
      const cons = CONSUMPTION_LABEL(item.consumption_type, item.consumption_val);
      if (item.text) drawText(item.text, font, 9.5, grey, 8);
      if (cons) drawText(`Consumption: ${cons}`, font, 9, indigo, 8);
      for (const v of item.variants || []) {
        const head = `• ${v.colors?.join(' / ') || 'All colors'}`;
        drawText(head, bold, 9.5, dark, 8);
        if (v.text) drawText(v.text, font, 9, grey, 18);
        const vcons = CONSUMPTION_LABEL(v.consumption_type, v.consumption_val);
        if (vcons) drawText(`Consumption: ${vcons}`, font, 9, indigo, 18);
        for (const sv of v.sizeVariants || []) {
          drawText(`– Sizes ${sv.sizes?.join(' / ') || ''}`, font, 9, dark, 18);
          if (sv.text) drawText(sv.text, font, 9, grey, 28);
          const scons = CONSUMPTION_LABEL(sv.consumption_type, sv.consumption_val);
          if (scons) drawText(`Consumption: ${scons}`, font, 9, indigo, 28);
        }
      }
      y -= 4;
      ensure(8);
      page.drawLine({ start: { x: margin, y }, end: { x: A4.w - margin, y }, thickness: 0.5, color: line });
      y -= 6;
    }
  }

  // ---- Custom items ----
  const custom = getStyleCustomItems(style);
  const customNames = Object.keys(custom);
  if (customNames.length) {
    section('Additional Items');
    for (const name of customNames) {
      const item = custom[name];
      drawText(name, bold, 11, dark);
      if (item?.text) drawText(item.text, font, 9.5, grey, 8);
      y -= 4;
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
};

// --- Action runners (deterministic, no AI) ----------------------------------

const runStyleFiles = async (token: string, chatId: number | string, styleNo: string, measureOnly: boolean) => {
  const style = await fetchStyleByNumber(styleNo.split(' - ')[0].trim());
  if (!style) {
    await sendTelegram(token, chatId, `Style "${styleNo}" not found.`, MAIN_MENU);
    return;
  }

  // Tech-pack request → generate & send ONE consolidated tech-pack PDF.
  if (!measureOnly) {
    await sendTelegram(token, chatId, `Building tech pack PDF for ${style.style_number}…`);
    try {
      const buf = await generateTechPackPdf(style);
      const safe = style.style_number.replace(/[^\w.\-]/g, '_');
      const url = await uploadToBucket(buf, `TechPack-${safe}.pdf`, 'application/pdf');
      if (url) {
        const sent = await sendTelegramDocument(token, chatId, url, `Tech Pack — ${style.style_number}`);
        if (sent.ok) {
          await sendMenu(token, chatId, 'Anything else?');
          return;
        }
      }
      await sendTelegram(token, chatId, `Could not deliver the tech pack PDF for ${style.style_number}.`, MAIN_MENU);
    } catch (e: any) {
      await sendTelegram(
        token,
        chatId,
        `Failed to build tech pack PDF: ${e?.message || 'unknown error'}.`,
        MAIN_MENU
      );
    }
    return;
  }

  // Measurement chart request → send the raw measurement/size-chart files.
  const atts = collectStyleAttachments(style, measureOnly);
  if (!atts.length) {
    await sendTelegram(
      token,
      chatId,
      `No measurement / size-chart files uploaded for style ${style.style_number}.`,
      MAIN_MENU
    );
    return;
  }
  await sendTelegram(token, chatId, `Sending ${atts.length} file(s) for ${style.style_number}…`);
  await deliverFiles(token, chatId, atts, style.style_number);
  await sendMenu(token, chatId, 'Anything else?');
};

const runStyleSummary = async (token: string, chatId: number | string, styleNo: string) => {
  const style = await fetchStyleByNumber(styleNo.split(' - ')[0].trim());
  if (!style) {
    await sendTelegram(token, chatId, `Style "${styleNo}" not found.`, MAIN_MENU);
    return;
  }
  const colors = (style.available_colors || []).filter(Boolean).join(', ') || '—';
  const sizes = (style.available_sizes || []).join(', ') || '—';
  const summary =
    `🧾 Style ${style.style_number}\n` +
    `Category: ${style.category || '—'}\n` +
    `Garment: ${style.garment_type || '—'}\n` +
    `Segment: ${style.demographic || '—'}\n` +
    `Colors: ${colors}\n` +
    `Sizes (${style.size_type || ''}): ${sizes}\n` +
    `Packing: ${style.packing_type || '—'} (${style.pcs_per_box ?? '—'} pcs/box)\n` +
    (style.style_text ? `\nNotes: ${style.style_text}` : '');
  await sendTelegram(token, chatId, summary);
  await sendMenu(token, chatId, 'Anything else?');
};

const runOrderStatus = async (token: string, chatId: number | string, orderRef: string) => {
  const orders = await fetchOrders();
  const order = findOrder(orders, orderRef);
  if (!order) {
    await sendTelegram(token, chatId, `Order "${orderRef}" not found.`, MAIN_MENU);
    return;
  }
  await sendOrderCard(token, chatId, order);
};

/** Rich, fully button-driven order card: status + every quick action that
 *  needs no AI (advance, files, measurement chart, materials, summary). */
const sendOrderCard = async (token: string, chatId: number | string, order: Order) => {
  const next = getNextOrderStatus(order.status);
  const text =
    `📦 ${formatOrderNumber(order)}\n` +
    `Style: ${order.style_number}\n` +
    `Qty: ${order.quantity}\n` +
    `Status: ${order.status}\n` +
    `Target: ${order.target_delivery_date || '—'}`;
  const rows: any[] = [];
  if (next) rows.push([{ text: `▶️ Advance to ${next}`, callback_data: `adv:${order.id}` }]);
  rows.push([
    { text: '📄 Files', callback_data: `ofiles:${order.id}` },
    { text: '📏 Measure', callback_data: `omeas:${order.id}` },
  ]);
  rows.push([
    { text: '🧵 Materials', callback_data: `omat:${order.id}` },
    { text: '🧾 Summary', callback_data: `osum:${order.id}` },
  ]);
  rows.push([{ text: '⬅️ Menu', callback_data: 'menu' }]);
  await sendTelegram(token, chatId, text, { inline_keyboard: rows });
};

/** List a single order's material/procurement lines, each tappable to view
 *  and advance its stage — no AI, no typing of UUIDs. */
const runOrderMaterials = async (token: string, chatId: number | string, orderRef: string) => {
  const orders = await fetchOrders();
  const order = findOrder(orders, orderRef);
  if (!order) {
    await sendTelegram(token, chatId, `Order "${orderRef}" not found.`, MAIN_MENU);
    return;
  }
  const procs = await orderProcurements(order.id);
  if (!procs.length) {
    await sendTelegram(token, chatId, `No materials are linked to ${formatOrderNumber(order)} yet.`, MAIN_MENU);
    return;
  }
  const rows = procs.map((p) => [
    { text: `🧵 ${p.material_name} (${procStageLine(p)})`.slice(0, 60), callback_data: `psel:${p.id}` },
  ]);
  rows.push([{ text: '⬅️ Menu', callback_data: 'menu' }]);
  await sendTelegram(
    token,
    chatId,
    `🧵 Materials for ${formatOrderNumber(order)} — tap one to update its stage:`,
    { inline_keyboard: rows }
  );
};

// --- New higher-value runners (deterministic, no AI) ------------------------

/** List every non-completed order as tappable cards. */
const runActiveOrders = async (token: string, chatId: number | string) => {
  const orders = await fetchOrders();
  const active = orders.filter((o) => o.status !== OrderStatus.COMPLETED);
  if (!active.length) {
    await sendTelegram(token, chatId, 'There are no active orders right now.', MAIN_MENU);
    return;
  }
  const shown = active.slice(0, 20);
  const rows = shown.map((o) => [
    {
      text: `📦 ${formatOrderNumber(o)} · ${(o.style_number || '').split(' - ')[0]} · ${o.status}`.slice(0, 60),
      callback_data: `ocard:${o.id}`,
    },
  ]);
  rows.push([{ text: '⬅️ Menu', callback_data: 'menu' }]);
  await sendTelegram(
    token,
    chatId,
    `📋 ${active.length} active order(s)${active.length > shown.length ? ` (showing first ${shown.length})` : ''} — tap one:`,
    { inline_keyboard: rows }
  );
};

/** A compact end-of-day snapshot: orders by status + materials by stage. */
const runDailySummary = async (token: string, chatId: number | string) => {
  const today = new Date().toISOString().slice(0, 10);
  const access = await loadBotAccess(chatId);
  const role = access.role || 'ADMIN';

  // Which sections this role should see in its daily summary.
  const wantsOrders = ['ADMIN', 'TECH_MANAGER', 'MANAGER'].includes(role);
  const wantsMaterials = ['ADMIN', 'TECH_MANAGER', 'ACCESSORIES_MANAGER'].includes(role);
  const wantsInventory = ['ADMIN', 'TECH_MANAGER', 'ACCOUNTS_INVENTORY'].includes(role);
  const wantsSales = ['ADMIN', 'TECH_MANAGER', 'MANAGER', 'ACCOUNTS_INVENTORY'].includes(role);

  // Fetch only what the role's sections need (parallel, best-effort).
  const [orders, procs, levels, sales] = await Promise.all([
    (wantsOrders || wantsMaterials || wantsInventory) ? fetchOrders() : Promise.resolve([] as Order[]),
    wantsMaterials ? fetchProcurements() : Promise.resolve([] as MaterialProcurement[]),
    wantsInventory ? fetchStockLevels() : Promise.resolve([] as any[]),
    wantsSales ? fetchSalesOrders() : Promise.resolve([] as SalesOrder[]),
  ]);

  const sections: string[] = [];

  if (wantsOrders) {
    const byStatus: Record<string, number> = {};
    for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    const dueToday = orders.filter((o) => (o.target_delivery_date || '') === today && o.status !== OrderStatus.COMPLETED);
    const overdue = orders.filter(
      (o) => o.target_delivery_date && o.target_delivery_date < today && o.status !== OrderStatus.COMPLETED
    );
    const statusLines = Object.entries(byStatus).map(([s, n]) => `  • ${s}: ${n}`).join('\n') || '  • none';
    sections.push(
      `🏭 Production orders (${orders.length})\n${statusLines}\n  • Due today: ${dueToday.length}\n  • Overdue: ${overdue.length}`
    );
  }

  if (wantsMaterials) {
    const stageQty: Record<string, number> = {};
    for (const p of procs) {
      for (const st of MATERIAL_STAGE_ORDER) {
        const q = procurementStageQty(p, st);
        if (q > 0) stageQty[st] = (stageQty[st] || 0) + q;
      }
    }
    const stageLines = MATERIAL_STAGE_ORDER.filter((s) => stageQty[s])
      .map((s) => `  • ${MATERIAL_STAGE_LABEL[s]}: ${stageQty[s]}`)
      .join('\n') || '  • none pending';
    const awaiting = procs.filter((p) => procurementStageQty(p, MaterialStage.REQUESTED) > 0).length;
    // Per-order: requested vs ordered vs received, so the materials desk knows
    // exactly which orders need an action right now.
    const orderMap = new Map<string, { req: number; ord: number; rec: number }>();
    for (const p of procs) {
      if (!p.order_id) continue;
      const m = orderMap.get(p.order_id) || { req: 0, ord: 0, rec: 0 };
      m.req += procurementStageQty(p, MaterialStage.REQUESTED);
      m.ord += procurementStageQty(p, MaterialStage.ORDERED);
      m.rec += procurementStageQty(p, MaterialStage.RECEIVED);
      orderMap.set(p.order_id, m);
    }
    const attention = Array.from(orderMap.entries())
      .map(([oid, m]) => ({ o: orders.find((x) => x.id === oid), ...m }))
      .filter((x) => x.o && (x.req > 0 || x.rec > 0))
      .sort((a, b) => (b.req + b.rec) - (a.req + a.rec))
      .slice(0, 5)
      .map((x) => `  • ${formatOrderNumber(x.o!)}: ${x.req} to order · ${x.ord} en route · ${x.rec} to release`);
    const attentionBlock = attention.length ? `\n  Orders needing you:\n${attention.join('\n')}` : '';
    sections.push(`🧵 Materials pipeline (${procs.length} lines)\n${stageLines}\n  • Awaiting order: ${awaiting}${attentionBlock}`);
  }

  if (wantsInventory) {
    const totalUnits = levels.reduce((a, l) => a + (Number(l.quantity) || 0), 0);
    const lines = levels.filter((l) => (Number(l.quantity) || 0) > 0);
    const outOf = levels.filter((l) => (Number(l.quantity) || 0) <= 0).length;
    const low = levels.filter((l) => { const q = Number(l.quantity) || 0; return q > 0 && q <= 20; }).length;
    const styleSet = new Set(levels.map((l) => l.style_number));
    // In production = orders not yet completed/committed to stock.
    const inProd = orders.filter((o) => o.status !== OrderStatus.COMPLETED);
    const inProdUnits = inProd.reduce((a, o) => a + (Number(o.quantity) || 0), 0);
    const inProdStyles = new Set(inProd.map((o) => o.style_number));
    sections.push(
      `📦 Inventory\n  On hand:\n  • Total units: ${totalUnits.toLocaleString()}\n  • Styles in stock: ${styleSet.size}\n  • Active lines: ${lines.length}\n  • Low (≤20): ${low}\n  • Out of stock: ${outOf}\n  In production (not yet stocked):\n  • Orders open: ${inProd.length}\n  • Styles: ${inProdStyles.size}\n  • Units expected: ${inProdUnits.toLocaleString()}`
    );
  }

  if (wantsSales) {
    const live = sales.filter((s) => s.status !== 'CANCELLED');
    const drafts = live.filter((s) => s.status === 'DRAFT');
    const forwardedToday = live.filter((s) => s.status === 'FORWARDED' && (s.forwarded_at || '').slice(0, 10) === today);
    const poToday = live.filter((s) => (s.po_date || '').slice(0, 10) === today);
    const piecesToday = poToday.reduce((a, s) => a + (Number(s.total_qty) || 0), 0);
    sections.push(
      `🧾 Sales / POs\n  • Drafts awaiting forward: ${drafts.length}\n  • Forwarded today: ${forwardedToday.length}\n  • New POs today: ${poToday.length} (${piecesToday.toLocaleString()} pcs)`
    );
  }

  const who = access.username ? access.username.split(/[ _.]/)[0] : '';
  const heading = `📊 Daily summary — ${today}\n${who ? `Hi ${who} · ` : ''}(${role.replace(/_/g, ' ')})`;
  const body = sections.length ? sections.join('\n\n') : 'No summary is configured for your role yet.';
  await sendTelegram(token, chatId, `${heading}\n\n${body}`, MAIN_MENU);
};

/** On-hand stock for a style, grouped by colour and size. */
const runStockLookup = async (token: string, chatId: number | string, styleRef: string) => {
  const styleNo = (styleRef || '').split(' - ')[0].trim();
  const levels = await fetchStockLevels();
  const mine = levels.filter((l) => (l.style_number || '').toLowerCase() === styleNo.toLowerCase());
  if (!mine.length) {
    await sendTelegram(token, chatId, `No on-hand stock recorded for style "${styleNo}".`, MAIN_MENU);
    return;
  }
  const byColor: Record<string, { size: string; qty: number }[]> = {};
  let total = 0;
  for (const l of mine) {
    const c = l.color || '—';
    (byColor[c] ||= []).push({ size: l.size || '—', qty: Number(l.quantity || 0) });
    total += Number(l.quantity || 0);
  }
  const blocks = Object.entries(byColor)
    .map(([color, rows]) => {
      const sub = rows.reduce((a, r) => a + r.qty, 0);
      const cells = rows
        .filter((r) => r.qty)
        .map((r) => `    ${r.size}: ${r.qty}`)
        .join('\n');
      return `🎨 ${color} (${sub})\n${cells || '    —'}`;
    })
    .join('\n');
  await sendTelegram(token, chatId, `🔎 Stock for ${styleNo} — total ${total}\n\n${blocks}`, MAIN_MENU);
};

/** Build stock-commit lines from an order's completed/planned size matrix. */
const buildCommitLines = (order: Order): StockCommitLine[] => {
  const format = order.size_format || 'standard';
  const labels =
    order.size_sequence && order.size_sequence.length
      ? order.size_sequence
      : format === 'numeric'
        ? ['65', '70', '75', '80', '85', '90']
        : ['S', 'M', 'L', 'XL', 'XXL', '3XL'];
  const rows: any[] =
    order.completion_breakdown && order.completion_breakdown.length
      ? order.completion_breakdown
      : order.size_breakdown || [];
  const lines: StockCommitLine[] = [];
  for (const row of rows) {
    for (const label of labels) {
      const key = getSizeKeyFromLabel(label, format);
      const qty = Number((row as any)[key] || 0);
      if (qty > 0) lines.push({ color: row.color || '—', size: label, qty });
    }
  }
  return lines;
};

// --- Callback (button tap) handling -----------------------------------------

/** Render a human-readable summary of an in-progress PO. */
const renderPoSummary = (pb: NonNullable<Flow['poBuilder']>): string => {
  const lines = pb.lines || [];
  const totalQty = lines.reduce((s, l) => s + (l.total || 0), 0);
  const totalAmt = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const body =
    lines
      .map((l, i) => {
        const sz = Object.keys(l.sizes || {}).length
          ? '  [' + Object.entries(l.sizes).map(([s, q]) => `${combinedSizeLabel(s)}:${q}`).join(' ') + ']'
          : '';
        return `  ${i + 1}. ${l.style_number} × ${l.total}${l.rate ? ` @ ${l.rate} = ${l.amount}` : ''}${sz}`;
      })
      .join('\n') || '  (no lines yet)';
  return (
    `🧾 PO ${pb.po_number || '(auto)'}\n` +
    `Buyer: ${pb.buyer_name || '—'}\n\n` +
    `${body}\n\n` +
    `Total qty: ${totalQty}${totalAmt ? ` · Amount: ${totalAmt}` : ''}`
  );
};

/** Build a PO PDF, upload it to storage, and send it to the chat as a document. */
const sendPoPdf = async (token: string, chatId: number | string, po: SalesOrder, captionPrefix?: string) => {
  try {
    const bytes = await buildPoPdfBytes(po);
    const safe = (po.po_number || 'PO').replace(/[^A-Za-z0-9._-]/g, '_');
    const url = await uploadToBucket(Buffer.from(bytes), `${safe}.pdf`, 'application/pdf');
    if (!url) {
      await sendTelegram(token, chatId, '⚠️ PO saved, but the PDF could not be uploaded to storage.');
      return;
    }
    await sendTelegramDocument(
      token,
      chatId,
      url,
      `${captionPrefix ? captionPrefix + '\n' : ''}PO ${po.po_number} · ${po.buyer_name} · ${po.total_qty} pcs — forward to Accounts & Inventory.`
    );
  } catch (e: any) {
    await sendTelegram(token, chatId, `⚠️ Could not generate the PO PDF: ${e?.message || 'unknown error'}.`);
  }
};

/** Persist the in-progress PO; optionally forward it to Inventory + Accounts. */
const finalizePo = async (token: string, chatId: number | string, forward: boolean) => {
  const flow = await loadFlow(chatId);
  const pb = flow.poBuilder;
  if (!pb || !pb.lines?.length) {
    await clearFlow(chatId);
    return sendTelegram(token, chatId, 'Nothing to save — the PO had no lines. Start again from the menu.', MAIN_MENU);
  }
  await clearFlow(chatId);
  try {
    const so = await createSalesOrder({
      po_number: '', // auto-assigned (sequential PO-0001…) by the database
      po_date: new Date().toISOString().slice(0, 10),
      buyer_name: pb.buyer_name || 'Walk-in',
      size_format: 'standard',
      size_labels: CANONICAL_SIZES,
      lines: pb.lines,
      created_by_name: 'Telegram',
    });
    if (forward) await forwardSalesOrder(so.id);
    await sendTelegram(
      token,
      chatId,
      `✅ PO ${so.po_number} ${forward ? 'forwarded to Inventory & Accounts' : 'saved as draft'}.\n` +
        `Buyer: ${so.buyer_name} · ${so.lines.length} line(s) · ${so.total_qty} pcs` +
        (so.total_amount ? ` · ₹${so.total_amount}` : ''),
      MAIN_MENU
    );
    // Generate + send the PO PDF so it can be forwarded to Accounts & Inventory.
    await sendPoPdf(token, chatId, forward ? { ...so, status: 'FORWARDED' } : so);
  } catch (e: any) {
    await sendTelegram(token, chatId, `Could not save the PO: ${e?.message || 'unknown error'}.`, MAIN_MENU);
  }
};

const handleCallback = async (token: string, chatId: number | string, data: string) => {
  // Role gate: block top-level actions the user's role can't access.
  if (data.startsWith('act:')) {
    const access = await loadBotAccess(chatId);
    if (access.enforced && !canUseBotAction(access.role, data)) {
      await sendTelegram(
        token,
        chatId,
        `🔒 Your role (${access.role || 'unregistered'}) doesn't have access to that action.`
      );
      return sendMenu(token, chatId, 'Here is what you can do:');
    }
  }
  if (data === 'act:files') {
    await saveFlow(chatId, { awaiting: 'style:files' });
    await sendTelegram(token, chatId, 'Send the style number to get its tech-pack files.');
  } else if (data === 'act:measure') {
    await saveFlow(chatId, { awaiting: 'style:measure' });
    await sendTelegram(token, chatId, 'Send the style number to get its measurement chart.');
  } else if (data === 'act:summary') {
    await saveFlow(chatId, { awaiting: 'style:summary' });
    await sendTelegram(token, chatId, 'Send the style number for a quick summary.');
  } else if (data === 'act:order') {
    await saveFlow(chatId, { awaiting: 'order' });
    await sendTelegram(token, chatId, 'Send the order number to see its status & actions.');
  } else if (data === 'act:upload') {
    await saveFlow(chatId, { awaiting: 'upload:style' });
    await sendTelegram(token, chatId, 'Send the style number you want to add files to.');
  } else if (data === 'act:reqadd') {
    await saveFlow(chatId, { awaiting: 'req:style' });
    await sendTelegram(token, chatId, 'Send the style number to add a per-piece quantity / requirement to.');
  } else if (data === 'act:matorder') {
    await saveFlow(chatId, { awaiting: 'matorder' });
    await sendTelegram(token, chatId, 'Send the order number to see its materials.');
  } else if (data === 'act:matpend') {
    await clearFlow(chatId);
    return runMaterialsToAction(token, chatId);
  } else if (data === 'act:voice') {
    await clearFlow(chatId);
    await sendTelegram(
      token,
      chatId,
      '🎙️ Send a voice note (or type). I can update an ORDER status or a MATERIAL stage.\n' +
        '• Order: "Order 1004 cutting started", "1004 packing done"\n' +
        '• Material: "Order 1004 black thread received", "1004 fabric ordered"'
    );
  } else if (data === 'act:ai') {
    await saveFlow(chatId, { awaiting: 'ai' });
    await sendTelegram(
      token,
      chatId,
      '🤖 Ask me anything about your orders, materials, stock or sales. Send your question now.'
    );
  } else if (data === 'act:orders') {
    await clearFlow(chatId);
    await runActiveOrders(token, chatId);
  } else if (data === 'act:daily') {
    await clearFlow(chatId);
    await runDailySummary(token, chatId);
  } else if (data === 'act:newmat') {
    await saveFlow(chatId, { awaiting: 'newmat:order', newMat: {} });
    await sendTelegram(
      token,
      chatId,
      '🆕 New material request.\nSend the order number this material is for, or type "skip" for a general (no-order) request.'
    );
  } else if (data === 'act:newpo') {
    await saveFlow(chatId, { awaiting: 'po:buyer', poBuilder: { lines: [] } });
    const buyers = await fetchBuyers().catch(() => [] as { id: string; name: string }[]);
    const rows = buyers
      .filter((b) => `pobuyer:${b.name}`.length <= 60)
      .slice(0, 8)
      .map((b) => [{ text: `👤 ${b.name}`, callback_data: `pobuyer:${b.name}` }]);
    await sendTelegram(
      token,
      chatId,
      '🧾 New sale / PO.\nPick a buyer below, or just type a new buyer name.',
      rows.length ? { inline_keyboard: rows } : undefined
    );
  } else if (data.startsWith('pobuyer:')) {
    const name = data.slice('pobuyer:'.length);
    await saveFlow(chatId, { awaiting: 'po:line_style', poBuilder: { lines: [], buyer_name: name } });
    await sendTelegram(
      token,
      chatId,
      `Buyer: ${name}.\nNow add styles. Send a style number to add a line, or type "done" when finished.`
    );
  } else if (data === 'pogo:draft') {
    await finalizePo(token, chatId, false);
  } else if (data === 'pogo:forward') {
    await finalizePo(token, chatId, true);
  } else if (data === 'act:popdf') {
    await clearFlow(chatId);
    const pos = await fetchSalesOrders().catch(() => [] as SalesOrder[]);
    if (!pos.length) {
      await sendTelegram(token, chatId, 'No purchase orders found yet. Raise one first with "Raise PO".', MAIN_MENU);
    } else {
      const rows = pos
        .slice(0, 10)
        .map((p) => [
          {
            text: `📄 ${p.po_number} · ${p.buyer_name} · ${p.total_qty}pcs`.slice(0, 60),
            callback_data: `popdf:${p.id}`,
          },
        ]);
      await sendTelegram(token, chatId, '📄 Pick a PO to get its PDF (forward it to Accounts & Inventory):', {
        inline_keyboard: rows,
      });
    }
  } else if (data.startsWith('popdf:')) {
    const id = data.slice('popdf:'.length);
    const pos = await fetchSalesOrders().catch(() => [] as SalesOrder[]);
    const po = pos.find((p) => String(p.id) === id);
    if (!po) {
      await sendTelegram(token, chatId, 'That PO could not be found. It may have been removed.', MAIN_MENU);
    } else {
      await sendPoPdf(token, chatId, po);
    }
  } else if (data === 'act:commit') {
    await saveFlow(chatId, { awaiting: 'commit:order' });
    await sendTelegram(token, chatId, '📥 Send the order number whose completed pieces you want to push into inventory.');
  } else if (data === 'act:stock') {
    await saveFlow(chatId, { awaiting: 'stock:style' });
    await sendTelegram(token, chatId, '🔎 Send the style number to see its on-hand stock.');
  } else if (data.startsWith('ocard:')) {
    const order = (await fetchOrders()).find((o) => o.id === data.slice('ocard:'.length));
    if (!order) return sendTelegram(token, chatId, 'That order no longer exists.', MAIN_MENU);
    return sendOrderCard(token, chatId, order);
  } else if (data.startsWith('commitgo:')) {
    const order = (await fetchOrders()).find((o) => o.id === data.slice('commitgo:'.length));
    if (!order) return sendTelegram(token, chatId, 'That order no longer exists.', MAIN_MENU);
    const lines = buildCommitLines(order);
    if (!lines.length) {
      return sendTelegram(token, chatId, `${formatOrderNumber(order)} has no completed pieces to commit.`, MAIN_MENU);
    }
    try {
      const commit = await commitOrderStock(order, lines, 'Telegram');
      const total = lines.reduce((a, l) => a + l.qty, 0);
      if (commit) {
        await recordLastAction(chatId, {
          kind: 'stock_commit', commitId: String(commit.id), orderId: order.id,
          orderNo: formatOrderNumber(order), total, at: new Date().toISOString(),
        });
      }
      return sendTelegram(
        token,
        chatId,
        `✅ Pushed ${total} piece(s) from ${formatOrderNumber(order)} into inventory across ${lines.length} colour/size line(s).\nWrong order? Tap Undo.`,
        undoMarkup()
      );
    } catch (e: any) {
      return sendTelegram(token, chatId, `Could not commit stock: ${e.message}`, MAIN_MENU);
    }
  } else if (data.startsWith('updst:')) {
    // Picked a destination for the style file upload.
    const dest = data.slice('updst:'.length);
    const flow = await loadFlow(chatId);
    if (!flow.upload) return sendTelegram(token, chatId, 'Start again from the menu.', MAIN_MENU);
    await saveFlow(chatId, {
      awaiting: 'upload:file',
      upload: { ...flow.upload, dest, destLabel: destinationLabel(dest) },
    });
    await sendTelegram(
      token,
      chatId,
      `📎 Now send the photo(s) or document(s) to attach to ${flow.upload.styleNumber} → ${destinationLabel(dest)}.\n` +
        `Send as many as you like, then tap Done.`,
      { inline_keyboard: [[{ text: '✅ Done', callback_data: 'menu' }]] }
    );
  } else if (data.startsWith('psel:')) {
    // Selected a procurement line to view/advance.
    const procId = data.slice('psel:'.length);
    const all = await fetchProcurements();
    const p = all.find((x) => x.id === procId);
    if (!p) return sendTelegram(token, chatId, 'That material line no longer exists.', MAIN_MENU);
    return sendProcurementCard(token, chatId, p);
  } else if (data.startsWith('padv:')) {
    // Advance a procurement stage. Format padv:<procId>:<STAGE>
    const rest = data.slice('padv:'.length);
    const idx = rest.lastIndexOf(':');
    const procId = rest.slice(0, idx);
    const toStage = rest.slice(idx + 1) as MaterialStage;
    if (toStage === MaterialStage.ORDERED) {
      // Ordering needs an invoice number — capture it first.
      const all = await fetchProcurements();
      const p = all.find((x) => x.id === procId);
      const qty = p ? procurementStageQty(p, MaterialStage.REQUESTED) : 0;
      await saveFlow(chatId, {
        awaiting: 'proc:invoice',
        procPending: { procId, material: p?.material_name || 'material', toStage, qty },
      });
      return sendTelegram(token, chatId, 'Send the invoice number for this purchase (required to mark as Ordered).');
    }
    return doAdvanceProcurement(token, chatId, procId, toStage);
  } else if (data.startsWith('pback:')) {
    // Correct / step a procurement stage back. Format pback:<procId>:<STAGE>
    const rest = data.slice('pback:'.length);
    const idx = rest.lastIndexOf(':');
    const procId = rest.slice(0, idx);
    const fromStage = rest.slice(idx + 1) as MaterialStage;
    return doRegressProcurement(token, chatId, procId, fromStage);
  } else if (data.startsWith('ofiles:')) {
    const order = (await fetchOrders()).find((o) => o.id === data.slice('ofiles:'.length));
    if (order) await runStyleFiles(token, chatId, order.style_number, false);
  } else if (data.startsWith('omeas:')) {
    const order = (await fetchOrders()).find((o) => o.id === data.slice('omeas:'.length));
    if (order) await runStyleFiles(token, chatId, order.style_number, true);
  } else if (data.startsWith('omat:')) {
    const order = (await fetchOrders()).find((o) => o.id === data.slice('omat:'.length));
    if (order) await runOrderMaterials(token, chatId, order.order_no || formatOrderNumber(order));
  } else if (data.startsWith('osum:')) {
    const order = (await fetchOrders()).find((o) => o.id === data.slice('osum:'.length));
    if (order) await runStyleSummary(token, chatId, order.style_number);
  } else if (data.startsWith('adv:')) {
    const orderId = data.slice(4);
    const orders = await fetchOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return sendTelegram(token, chatId, 'That order no longer exists.');
    const next = getNextOrderStatus(order.status);
    if (!next) return sendTelegram(token, chatId, `${formatOrderNumber(order)} is already at the final stage.`);
    const prev = order.status;
    await updateOrderStatus(order.id, next, 'Updated via Telegram');
    await recordLastAction(chatId, {
      kind: 'order_status', orderId: order.id, orderNo: formatOrderNumber(order),
      prevStatus: prev, newStatus: next, at: new Date().toISOString(),
    });
    return sendTelegram(token, chatId, `✅ ${formatOrderNumber(order)} moved to ${next}.`, undoMarkup());
  } else if (data === 'upd:ok') {
    const flow = await loadFlow(chatId);
    if (!flow.pendingUpdate) return sendTelegram(token, chatId, 'Nothing to confirm.', MAIN_MENU);
    const { orderId, orderNo, status, current } = flow.pendingUpdate;
    await updateOrderStatus(orderId, status, 'Updated via Telegram voice');
    await recordLastAction(chatId, {
      kind: 'order_status', orderId, orderNo, prevStatus: current, newStatus: status, at: new Date().toISOString(),
    });
    return sendTelegram(token, chatId, `✅ ${orderNo} set to ${status}.`, undoMarkup());
  } else if (data === 'upd:no') {
    await clearFlow(chatId);
    return sendTelegram(token, chatId, 'Cancelled.', MAIN_MENU);
  } else if (data === 'undo:last') {
    return runUndoLast(token, chatId);
  } else if (data === 'menu') {
    await clearFlow(chatId);
    return sendMenu(token, chatId);
  }
};

/** Interpret a spoken/typed update — either a production-order status change or
 *  a material/procurement stage move — and reply with a confirmation. */
const handleSpokenUpdate = async (token: string, chatId: number | string, transcript: string) => {
  const parsed = await parseUpdate(transcript);
  const orders = await fetchOrders();

  // ---- Material / procurement update ----
  if (parsed.kind === 'material') {
    if (!parsed.order_number) {
      return sendTelegram(
        token,
        chatId,
        'Which order is this material for? Say e.g. "Order 1004 black thread received".',
        MAIN_MENU
      );
    }
    const order = findOrder(orders, parsed.order_number);
    if (!order) return sendTelegram(token, chatId, `Order "${parsed.order_number}" not found.`, MAIN_MENU);
    const procs = await orderProcurements(order.id);
    if (!procs.length) {
      return sendTelegram(token, chatId, `No materials are linked to ${formatOrderNumber(order)}.`, MAIN_MENU);
    }
    let matches = procs;
    if (parsed.material) {
      const kw = parsed.material.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const narrowed = procs.filter((p) => kw.some((w) => p.material_name.toLowerCase().includes(w)));
      if (narrowed.length) matches = narrowed;
    }
    const stage = parsed.stage;
    if (matches.length === 1 && stage) {
      const p = matches[0];
      const from = prevMaterialStage(stage);
      const qty = from ? procurementStageQty(p, from) : 0;
      if (!from || qty <= 0) {
        return sendTelegram(
          token,
          chatId,
          `Nothing is at the previous stage to move into ${MATERIAL_STAGE_LABEL[stage]} for ${p.material_name}.`,
          MAIN_MENU
        );
      }
      if (stage === MaterialStage.ORDERED) {
        // If the invoice number was already spoken/typed, mark it Ordered right
        // away instead of opening a follow-up question.
        if (parsed.invoice) {
          return doAdvanceProcurement(token, chatId, p.id, stage, parsed.invoice);
        }
        await saveFlow(chatId, {
          awaiting: 'proc:invoice',
          procPending: { procId: p.id, material: p.material_name, toStage: stage, qty },
        });
        return sendTelegram(
          token,
          chatId,
          `Send the invoice number to mark ${p.material_name} (${qty} ${p.unit}) as Ordered.`
        );
      }
      return sendTelegram(
        token,
        chatId,
        `Confirm: ${p.material_name} ${qty} ${p.unit} → ${MATERIAL_STAGE_LABEL[stage]}?`,
        {
          inline_keyboard: [
            [
              { text: '✅ Confirm', callback_data: `padv:${p.id}:${stage}` },
              { text: '❌ Cancel', callback_data: 'menu' },
            ],
          ],
        }
      );
    }
    const rows = matches.map((p) => [
      { text: `🧵 ${p.material_name} (${procStageLine(p)})`.slice(0, 60), callback_data: `psel:${p.id}` },
    ]);
    rows.push([{ text: '⬅️ Menu', callback_data: 'menu' }]);
    return sendTelegram(token, chatId, `Tap the material to update for ${formatOrderNumber(order)}:`, {
      inline_keyboard: rows,
    });
  }

  // ---- Production-order status update ----
  // A finishing sub-process (ironing, pressing, etc.) or any message with no
  // recognised status is treated as a free-text progress NOTE for the timeline,
  // not a status change — even if it contains a word like "done"/"completed".
  const isNote = !parsed.status || SUBPROCESS_WORDS.test(transcript);
  if (isNote) {
    const order = parsed.order_number ? findOrder(orders, parsed.order_number) : undefined;
    if (order) {
      const note = await toEnglishNote(transcript);
      await addOrderLog(order.id, 'MANUAL_UPDATE', note, 'Telegram');
      return sendTelegram(
        token,
        chatId,
        `📝 Added to ${formatOrderNumber(order)}'s timeline:\n"${note}"`,
        MAIN_MENU
      );
    }
    // We have a note but don't yet know which order it belongs to — ask.
    await saveFlow(chatId, { awaiting: 'note:order', pendingNote: transcript });
    return sendTelegram(
      token,
      chatId,
      'Got it. Which order is this update for? Send the order number and I will add your message to its timeline.'
    );
  }

  if (!parsed.order_number) {
    return sendTelegram(
      token,
      chatId,
      'I need an order number. Example: "Order 1004 packing done".',
      MAIN_MENU
    );
  }
  const order = findOrder(orders, parsed.order_number);
  if (!order) return sendTelegram(token, chatId, `Order "${parsed.order_number}" not found.`, MAIN_MENU);
  // The order is already at this status — this isn't a status change, it's a
  // progress note. Log it to the timeline instead of asking to confirm a no-op
  // like "IN_PROGRESS → IN_PROGRESS".
  if (order.status === parsed.status) {
    const note = await toEnglishNote(transcript);
    await addOrderLog(order.id, 'MANUAL_UPDATE', note, 'Telegram');
    return sendTelegram(
      token,
      chatId,
      `📝 ${formatOrderNumber(order)} is already ${parsed.status}. Added your update to its timeline:\n"${note}"`,
      MAIN_MENU
    );
  }
  await saveFlow(chatId, {
    pendingUpdate: {
      orderId: order.id,
      orderNo: formatOrderNumber(order),
      status: parsed.status,
      current: order.status,
    },
  });
  return sendTelegram(token, chatId, `Confirm update?\n${formatOrderNumber(order)}: ${order.status} → ${parsed.status}`, {
    inline_keyboard: [
      [
        { text: '✅ Confirm', callback_data: 'upd:ok' },
        { text: '❌ Cancel', callback_data: 'upd:no' },
      ],
    ],
  });
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN missing' });

  // Verify the request really came from Telegram.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ ok: false });
  }

  const update = req.body;
  const cb = update?.callback_query;
  const msg = update?.message;
  const chatId = msg?.chat?.id ?? cb?.message?.chat?.id;
  if (!chatId) return res.status(200).json({ ok: true });

  // Fresh access lookups per webhook invocation (roles can change in Control Center).
  botAccessCache.clear();

  // Gate behind the telegram_bot feature toggle.
  if (!(await featureEnabled('telegram_bot'))) {
    await sendTelegram(token, chatId, 'The Telegram assistant is currently turned off.');
    return res.status(200).json({ ok: true });
  }

  // Optional allow-list.
  const allowed = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(String(chatId))) {
    await sendTelegram(token, chatId, 'You are not authorised to use this assistant.');
    return res.status(200).json({ ok: true });
  }

  // Role-based access: once any user is linked to a chat id, unknown chats are
  // told their own id so an admin can register them in the Control Center.
  const access = await loadBotAccess(chatId);
  if (access.enforced && !access.registered) {
    await sendTelegram(
      token,
      chatId,
      `👋 You're not registered to use this bot yet.\n\n` +
        `Your Telegram chat ID is: ${chatId}\n\n` +
        `Share it with an admin to get access (Control Center → Telegram Access).`
    );
    return res.status(200).json({ ok: true });
  }

  try {
    // --- Button taps --------------------------------------------------------
    if (cb) {
      await answerCallback(token, cb.id);
      await handleCallback(token, chatId, String(cb.data || ''));
      return res.status(200).json({ ok: true });
    }

    // --- Incoming photo / document → attach to a style OR an order timeline --
    const photo = msg?.photo as any[] | undefined;
    const doc = msg?.document;
    if (photo?.length || doc?.file_id) {
      const flow = await loadFlow(chatId);
      const fileId = doc?.file_id || photo![photo!.length - 1].file_id;
      const isImage = !!photo?.length || /^image\//.test(doc?.mime_type || '');

      // 0) A photo sent right after saving a requirement → attach it to that
      //    requirement (item-level, or to its colour variant).
      if (flow.awaiting === 'req:line' && flow.reqLast) {
        const dl = await downloadTelegramFile(token, fileId, doc?.file_name || 'photo.jpg');
        if (!dl) {
          await sendTelegram(token, chatId, 'Could not download that photo. Please try again.');
          return res.status(200).json({ ok: true });
        }
        const fileName = doc?.file_name || dl.name;
        const url = await uploadToBucket(dl.buf, fileName, doc?.mime_type || dl.contentType);
        if (!url) {
          await sendTelegram(token, chatId, 'Upload failed. Please try again.');
          return res.status(200).json({ ok: true });
        }
        const att: Attachment = { name: fileName, url, type: isImage ? 'image' : 'document' };
        const ok = await attachPhotoToRequirement(flow.reqLast, att);
        await sendTelegram(
          token,
          chatId,
          ok
            ? `📎 Photo attached to "${flow.reqLast.fieldName}"${flow.reqLast.colorKey ? ` (${flow.reqLast.colorKey})` : ''}.\nSend more photos, the next requirement line, or tap Done.`
            : 'Photo uploaded but could not be attached. The requirement may have changed.',
          { inline_keyboard: [[{ text: '✅ Done', callback_data: 'menu' }]] }
        );
        return res.status(200).json({ ok: true });
      }

      // 1) Guided "Add files to a style" flow.
      if (flow.awaiting === 'upload:file' && flow.upload?.dest) {
        const dl = await downloadTelegramFile(token, fileId, doc?.file_name || 'upload');
        if (!dl) {
          await sendTelegram(token, chatId, 'Could not download that file. Please try again.');
          return res.status(200).json({ ok: true });
        }
        const fileName = doc?.file_name || dl.name;
        const url = await uploadToBucket(dl.buf, fileName, doc?.mime_type || dl.contentType);
        if (!url) {
          await sendTelegram(token, chatId, 'Upload failed. Make sure the storage bucket is reachable, then try again.');
          return res.status(200).json({ ok: true });
        }
        const att: Attachment = { name: fileName, url, type: isImage ? 'image' : 'document' };
        // "__auto__" routes photos to the poster gallery and files to general.
        const dest = flow.upload.dest === '__auto__' ? (isImage ? '__poster__' : '__general__') : flow.upload.dest;
        const ok = await attachFileToStyle(flow.upload.styleNumber, dest, att);
        await sendTelegram(
          token,
          chatId,
          ok
            ? `✅ Added to ${flow.upload.styleNumber} → ${destinationLabel(dest)}. Send more, or tap Done.`
            : 'File uploaded but could not be attached (style not found).',
          { inline_keyboard: [[{ text: '✅ Done', callback_data: 'menu' }]] }
        );
        return res.status(200).json({ ok: true });
      }

      // 2) One-shot caption shortcut: send a photo/file captioned
      //    "style <number> [section]" to attach it straight to a style — no menu.
      const capRaw = (msg?.caption || '').trim();
      const styleCmd = capRaw.match(/^(?:style|st|#style)\b[\s:#]*(\S+)(?:\s+(.+))?$/i);
      if (styleCmd) {
        const styleRef = styleCmd[1];
        const sectionHint = (styleCmd[2] || '').trim();
        const style = await fetchStyleByNumber(styleRef.split(' - ')[0].trim());
        if (!style) {
          await sendTelegram(
            token,
            chatId,
            `Style "${styleRef}" not found. Send the exact style number, or tap "Add files to a style".`,
            MAIN_MENU
          );
          return res.status(200).json({ ok: true });
        }
        const dl = await downloadTelegramFile(token, fileId, doc?.file_name || 'upload');
        if (!dl) {
          await sendTelegram(token, chatId, 'Could not download that file. Please try again.');
          return res.status(200).json({ ok: true });
        }
        const fileName = doc?.file_name || dl.name;
        const url = await uploadToBucket(dl.buf, fileName, doc?.mime_type || dl.contentType);
        if (!url) {
          await sendTelegram(token, chatId, 'Upload failed. Please try again.');
          return res.status(200).json({ ok: true });
        }
        const att: Attachment = { name: fileName, url, type: isImage ? 'image' : 'document' };
        let dest = isImage ? '__poster__' : '__general__';
        if (sectionHint) {
          const cats = styleUploadDestinations(style);
          const found = cats.find(
            (c) =>
              destinationLabel(c).toLowerCase() === sectionHint.toLowerCase() ||
              c.toLowerCase() === sectionHint.toLowerCase()
          );
          dest = found || sectionHint; // unknown section name → create a custom one
        }
        const ok = await attachFileToStyle(style.style_number, dest, att);
        await sendTelegram(
          token,
          chatId,
          ok
            ? `✅ Added to ${style.style_number} → ${destinationLabel(dest)}.\nSend more with the same caption, or tap Done.`
            : 'File uploaded but could not be attached to that style.',
          { inline_keyboard: [[{ text: '✅ Done', callback_data: 'menu' }]] }
        );
        return res.status(200).json({ ok: true });
      }

      // 3) If the photo is captioned as a PO request, try extracting the PO and creating a draft.
      if (caption && isImage && isPoLaunchText(caption)) {
        const dlPo = await downloadTelegramFile(token, fileId, doc?.file_name || 'photo.jpg');
        if (!dlPo) {
          await sendTelegram(token, chatId, 'Could not download that photo. Please try again.');
          return res.status(200).json({ ok: true });
        }
        const parsed = (await extractPoFromImage(dlPo.buf, dlPo.contentType, caption)) || (await parsePoFromText(caption));
        if (parsed.lines.length) {
          await createDraftPoFromParsed(token, chatId, parsed, caption, wantsPoForward(caption));
          return res.status(200).json({ ok: true });
        }
        await sendTelegram(
          token,
          chatId,
          'I could not recognise the PO details from that image. Please send the buyer name and style quantities as text or attach a clearer table image.',
          MAIN_MENU
        );
        return res.status(200).json({ ok: true });
      }

      // 4) Otherwise treat an IMAGE as a status-timeline photo for an order.
      if (!isImage) {
        await sendTelegram(
          token,
          chatId,
          'To attach a file to a style, tap "📎 Add files to a style" — or send it captioned "style <number>".',
          MAIN_MENU
        );
        return res.status(200).json({ ok: true });
      }
      const dl = await downloadTelegramFile(token, fileId, doc?.file_name || 'photo.jpg');
      if (!dl) {
        await sendTelegram(token, chatId, 'Could not download that photo. Please try again.');
        return res.status(200).json({ ok: true });
      }
      const fileName = doc?.file_name || dl.name;
      const url = await uploadToBucket(dl.buf, fileName, doc?.mime_type || dl.contentType);
      if (!url) {
        await sendTelegram(token, chatId, 'Photo upload failed. Please try again.');
        return res.status(200).json({ ok: true });
      }
      const caption = capRaw;
      const orders = await fetchOrders();
      const ref = (caption.match(/\d{2,}/) || [])[0];
      const order = ref ? findOrder(orders, ref) : undefined;
      if (order) {
        const note = caption ? await toEnglishNote(caption) : '📷 Photo update';
        await addOrderLog(order.id, 'MANUAL_UPDATE', note, 'Telegram', [{ url, name: fileName }]);
        await sendTelegram(
          token,
          chatId,
          `📷 Added a photo to ${formatOrderNumber(order)}'s timeline${caption ? `:\n"${note}"` : '.'}`,
          MAIN_MENU
        );
        return res.status(200).json({ ok: true });
      }
      // Don't know the order yet — keep the photo and ask which order it's for.
      await saveFlow(chatId, { awaiting: 'note:order', pendingNote: caption, pendingImages: [url] });
      await sendTelegram(
        token,
        chatId,
        'Got the photo. Which order is it for? Send the order number and I will add it to that order\'s timeline.'
      );
      return res.status(200).json({ ok: true });
    }

    // --- Voice note → status update (the ONLY place AI is used) --------------
    const voice = msg?.voice || msg?.audio || msg?.video_note;
    if (!msg?.text && !msg?.caption && voice?.file_id) {
      await sendTelegram(token, chatId, '🎙️ Got it, listening…');
      const transcript = await transcribeTelegram(token, voice.file_id, voice.mime_type);
      if (!transcript) {
        await sendTelegram(token, chatId, "Sorry, I couldn't understand that. Please try again or use the menu.", MAIN_MENU);
        return res.status(200).json({ ok: true });
      }
      await sendTelegram(token, chatId, `📝 "${transcript}"`);
      if (isPoLaunchText(transcript)) {
        const parsed = await parsePoFromText(transcript);
        if (parsed.lines.length) {
          const forward = wantsPoForward(transcript);
          await createDraftPoFromParsed(token, chatId, parsed, transcript, forward);
          return res.status(200).json({ ok: true });
        }
        await sendTelegram(
          token,
          chatId,
          'I recognised a PO request, but could not extract the line details. Please send the buyer name and style quantities in text, or attach a clearer table image.',
          MAIN_MENU
        );
        return res.status(200).json({ ok: true });
      }
      await handleSpokenUpdate(token, chatId, transcript);
      return res.status(200).json({ ok: true });
    }

    // --- Text messages ------------------------------------------------------
    const text = (msg?.text || msg?.caption || '').trim();
    if (!text) return res.status(200).json({ ok: true });

    if (isPoLaunchText(text)) {
      const parsed = await parsePoFromText(text);
      if (parsed.lines.length) {
        await createDraftPoFromParsed(token, chatId, parsed, text, wantsPoForward(text));
        return res.status(200).json({ ok: true });
      }
      await sendTelegram(
        token,
        chatId,
        'To create a PO, send the buyer name and style quantities as text or attach an image of the PO table. Example: "Buyer: ABC\nStyle 1001 S:10 M:20 L:5".',
        MAIN_MENU
      );
      return res.status(200).json({ ok: true });
    }
    if (/^\/(start|menu)\b/i.test(text)) {
      await clearFlow(chatId);
      await sendMenu(token, chatId, 'Tintura bot. Tap what you need:');
      return res.status(200).json({ ok: true });
    }
    if (/^\/help\b/i.test(text)) {
      await sendTelegram(
        token,
        chatId,
        '🤖 Tintura bot — quick guide\n\n' +
          '• Tap a menu button, or just send an order number to act on it.\n' +
          '• 📥 Materials to action — one tap shows every material waiting to be ordered, received or released. No need to remember order numbers.\n' +
          '• Every material card has ▶️ forward and ↩️ Fix buttons, so a wrong tap is never a dead end.\n' +
          '• Made a mistake? Tap ↩️ Undo or send /undo to reverse your last action.\n' +
          '• 🎙️ Send a voice note to update an order or material hands-free.\n\n' +
          'Other commands: /menu  /undo  /reset  /id',
        MAIN_MENU
      );
      return res.status(200).json({ ok: true });
    }
    if (/^\/(id|whoami|chatid|myid)\b/i.test(text)) {
      const who = await loadBotAccess(chatId);
      const status = !who.enforced
        ? 'Access control is not set up yet — paste this ID into the Control Center → Telegram Access to start linking users.'
        : who.registered
          ? `You are linked as ${who.username || 'a user'} (role: ${who.role}).`
          : 'You are not linked to any user yet. Share this ID with an admin to get access.';
      await sendTelegram(token, chatId, `Your Telegram chat ID is:\n\n${chatId}\n\n${status}`);
      return res.status(200).json({ ok: true });
    }
    if (/^\/(reset|new|clear|cancel)\b/i.test(text)) {
      await clearFlow(chatId);
      await sendTelegram(token, chatId, 'Cleared.', MAIN_MENU);
      return res.status(200).json({ ok: true });
    }
    if (/^\/undo\b/i.test(text)) {
      await runUndoLast(token, chatId);
      return res.status(200).json({ ok: true });
    }

    // If we previously asked for an input, treat this text as that input.
    const flow = await loadFlow(chatId);
    if (flow.awaiting === 'style:files') {
      await clearFlow(chatId);
      await runStyleFiles(token, chatId, text, false);
    } else if (flow.awaiting === 'style:measure') {
      await clearFlow(chatId);
      await runStyleFiles(token, chatId, text, true);
    } else if (flow.awaiting === 'style:summary') {
      await clearFlow(chatId);
      await runStyleSummary(token, chatId, text);
    } else if (flow.awaiting === 'order') {
      await clearFlow(chatId);
      await runOrderStatus(token, chatId, text);
    } else if (flow.awaiting === 'matorder') {
      await clearFlow(chatId);
      await runOrderMaterials(token, chatId, text);
    } else if (flow.awaiting === 'upload:style') {
      const style = await fetchStyleByNumber(text.split(' - ')[0].trim());
      if (!style) {
        await sendTelegram(token, chatId, `Style "${text}" not found. Send the exact style number.`, MAIN_MENU);
        await clearFlow(chatId);
      } else {
        const dests = styleUploadDestinations(style).filter((d) => `updst:${d}`.length <= 60);
        // Go straight to accepting files with a smart default — no mandatory
        // section pick. Photos land in the poster gallery, documents in general.
        await saveFlow(chatId, {
          awaiting: 'upload:file',
          upload: { styleNumber: style.style_number, destinations: dests, dest: '__auto__', destLabel: destinationLabel('__auto__') },
        });
        const rows = dests.map((d) => [{ text: `📂 ${destinationLabel(d)}`, callback_data: `updst:${d}` }]);
        await sendTelegram(
          token,
          chatId,
          `📎 ${style.style_number}: just send the photos/files now — photos go to the Poster gallery, documents to General files.\n\nWant a specific section instead? Tap one below first.`,
          { inline_keyboard: [...rows, [{ text: '✅ Done', callback_data: 'menu' }]] }
        );
      }
    } else if (flow.awaiting === 'req:style') {
      const style = await fetchStyleByNumber(text.split(' - ')[0].trim());
      if (!style) {
        await sendTelegram(token, chatId, `Style "${text}" not found. Send the exact style number.`, MAIN_MENU);
        await clearFlow(chatId);
      } else {
        await saveFlow(chatId, { awaiting: 'req:line', req: { styleNumber: style.style_number } });
        await sendTelegram(
          token,
          chatId,
          `➕ ${style.style_number}: send the requirement in one line, e.g.\n` +
            '• "Main fabric 1.2 meter"\n' +
            '• "Buttons 6 per piece"\n' +
            '• "1 cone for 50 pieces"\n' +
            '• "Lining 1.1 meter only for Red" (colour-specific)\n\n' +
            'After saving a line you can send a 📷 photo to attach it to that requirement.\n' +
            'Send another line for more, or tap Done.',
          { inline_keyboard: [[{ text: '✅ Done', callback_data: 'menu' }]] }
        );
      }
    } else if (flow.awaiting === 'req:line') {
      const styleNumber = flow.req?.styleNumber;
      if (!styleNumber) {
        await clearFlow(chatId);
        await sendTelegram(token, chatId, 'Session expired. Tap "Add quantity / requirement" to start again.', MAIN_MENU);
      } else {
        let parsed = parseRequirementText(text);
        if (!parsed) parsed = await aiParseRequirement(text);
        if (!parsed) {
          await sendTelegram(
            token,
            chatId,
            'Could not read a quantity there. Try e.g. "Main fabric 1.2 meter", "1 cone for 50 pieces", or "Lining 1.1 meter only for Red".',
            { inline_keyboard: [[{ text: '✅ Done', callback_data: 'menu' }]] }
          );
        } else {
          const ref = await addProductionRequirement(styleNumber, parsed);
          // Keep the flow open; remember this requirement so a follow-up photo attaches to it.
          await saveFlow(chatId, {
            awaiting: 'req:line',
            req: { styleNumber },
            reqLast: ref || undefined,
          });
          await sendTelegram(
            token,
            chatId,
            ref
              ? `✅ ${styleNumber}: "${parsed.name}" → ${requirementSummary(parsed)}.\n📷 Send a photo now to attach it here, or send the next requirement. Tap Done when finished.`
              : 'Saved the values but could not update the style. Please try again.',
            { inline_keyboard: [[{ text: '✅ Done', callback_data: 'menu' }]] }
          );
        }
      }
    } else if (flow.awaiting === 'proc:invoice') {
      const pend = flow.procPending;
      await clearFlow(chatId);
      if (!pend) {
        await sendTelegram(token, chatId, 'Nothing pending. Tap an action to begin.', MAIN_MENU);
      } else {
        await doAdvanceProcurement(token, chatId, pend.procId, pend.toStage, text.trim());
      }
    } else if (flow.awaiting === 'newmat:order') {
      const skip = /^(skip|none|no|general|-)$/i.test(text.trim());
      if (skip) {
        await saveFlow(chatId, { awaiting: 'newmat:name', newMat: { orderId: null } });
        await sendTelegram(token, chatId, 'General request. What material do you need? (e.g. "Black sewing thread")');
      } else {
        const order = findOrder(await fetchOrders(), text);
        if (!order) {
          await sendTelegram(token, chatId, `Order "${text}" not found. Send a valid order number, or "skip".`);
        } else {
          await saveFlow(chatId, {
            awaiting: 'newmat:name',
            newMat: { orderId: order.id, orderNo: formatOrderNumber(order), styleNumber: order.style_number },
          });
          await sendTelegram(
            token,
            chatId,
            `Order ${formatOrderNumber(order)} (${(order.style_number || '').split(' - ')[0]}). What material do you need?`
          );
        }
      }
    } else if (flow.awaiting === 'newmat:name') {
      const name = text.trim();
      if (!name) {
        await sendTelegram(token, chatId, 'Please send the material name.');
      } else {
        await saveFlow(chatId, { awaiting: 'newmat:qty', newMat: { ...(flow.newMat || {}), material: name } });
        await sendTelegram(token, chatId, `How much "${name}" is needed? Send a number (the quantity).`);
      }
    } else if (flow.awaiting === 'newmat:qty') {
      const qty = Number((text.match(/[\d.]+/) || [])[0] || 0);
      const nm = flow.newMat || {};
      await clearFlow(chatId);
      if (!qty || qty <= 0) {
        await sendTelegram(token, chatId, 'That quantity was not a positive number. Start again from the menu.', MAIN_MENU);
      } else {
        try {
          const proc = await createProcurement({
            order_id: nm.orderId || undefined,
            style_number: (nm.styleNumber || '').split(' - ')[0] || '',
            material_name: nm.material || 'Material',
            total_quantity: qty,
            startStage: MaterialStage.REQUESTED,
            created_by_name: 'Telegram',
          });
          await sendTelegram(
            token,
            chatId,
            `✅ Raised material request: ${proc.material_name} × ${qty}` +
              (nm.orderNo ? ` for ${nm.orderNo}` : '') +
              ` — stage Requested.`,
            MAIN_MENU
          );
        } catch (e: any) {
          await sendTelegram(token, chatId, `Could not create the request: ${e.message}`, MAIN_MENU);
        }
      }
    } else if (flow.awaiting === 'po:buyer') {
      const buyer = text.trim();
      if (!buyer) {
        await sendTelegram(token, chatId, 'Please send the buyer / customer name.');
      } else {
        await saveFlow(chatId, {
          awaiting: 'po:line_style',
          poBuilder: { ...(flow.poBuilder || { lines: [] }), buyer_name: buyer },
        });
        await sendTelegram(
          token,
          chatId,
          `Buyer: ${buyer}.\nNow add styles. Send a style number to add a line, or type "done" when finished.`
        );
      }
    } else if (flow.awaiting === 'po:number') {
      // Legacy step kept for safety; PO numbers are now auto-assigned.
      await saveFlow(chatId, { awaiting: 'po:line_style', poBuilder: flow.poBuilder || { lines: [] } });
      await sendTelegram(token, chatId, 'Add styles. Send a style number, or type "done" when finished.');
    } else if (flow.awaiting === 'po:line_style') {
      const raw = text.trim();
      const pb = flow.poBuilder || { lines: [] };
      if (/^(done|finish|end|save)$/i.test(raw)) {
        if (!pb.lines.length) {
          await sendTelegram(token, chatId, 'No styles added yet. Send a style number first, or /cancel.');
        } else {
          await saveFlow(chatId, { awaiting: 'po:line_style', poBuilder: pb });
          await sendTelegram(token, chatId, renderPoSummary(pb), {
            inline_keyboard: [
              [{ text: '💾 Save as Draft', callback_data: 'pogo:draft' }],
              [{ text: '🚀 Save & Forward', callback_data: 'pogo:forward' }],
              [{ text: '❌ Cancel', callback_data: 'menu' }],
            ],
          });
        }
      } else if (!raw) {
        await sendTelegram(token, chatId, 'Send a style number, or "done" to finish.');
      } else {
        await saveFlow(chatId, { awaiting: 'po:line_sizes', poBuilder: { ...pb, curStyle: raw } });
        await sendTelegram(
          token,
          chatId,
          `Style ${raw}. Send the size breakdown, e.g. \`S:10 M:20 L:5\` or \`65:10 70:20\`.\n` +
            `(You can also send a single number for an all-sizes total, but a breakdown lets it deduct stock.)`
        );
      }
    } else if (flow.awaiting === 'po:line_sizes') {
      const pb = flow.poBuilder || { lines: [] };
      const raw = text.trim();
      const sizes: Record<string, number> = {};
      let total = 0;
      const pairRe = /([A-Za-z0-9]+)\s*[:=xX]\s*(\d+)/g;
      let m: RegExpExecArray | null;
      while ((m = pairRe.exec(raw))) {
        const key = normalizeSize(m[1]);
        const q = parseInt(m[2], 10) || 0;
        if (q > 0) {
          sizes[key] = (sizes[key] || 0) + q;
          total += q;
        }
      }
      // Fallback: a bare number = a total with no size breakdown.
      if (total === 0) {
        const bare = Number((raw.match(/\d+/) || [])[0] || 0);
        if (bare > 0) total = bare;
      }
      if (total <= 0) {
        await sendTelegram(token, chatId, 'I couldn\'t read any quantities. Try `S:10 M:20 L:5`.');
      } else {
        await saveFlow(chatId, { awaiting: 'po:line_rate', poBuilder: { ...pb, curSizes: sizes, curQty: total } });
        const breakdown = Object.keys(sizes).length
          ? Object.entries(sizes).map(([s, q]) => `${combinedSizeLabel(s)}:${q}`).join(' ')
          : `${total} (no size split)`;
        await sendTelegram(token, chatId, `Sizes ${breakdown} · total ${total}. Rate per piece? Send a number, or "skip".`);
      }
    } else if (flow.awaiting === 'po:line_rate') {
      const pb = flow.poBuilder || { lines: [] };
      const skip = /^(skip|none|no|-|0)$/i.test(text.trim());
      const rate = skip ? 0 : Number((text.match(/[\d.]+/) || [])[0] || 0);
      const total = pb.curQty || 0;
      const line: SalesOrderLine = {
        style_number: (pb.curStyle || '').split(' - ')[0].trim() || 'Style',
        sizes: pb.curSizes || {},
        total,
        rate: rate || undefined,
        amount: rate ? Math.round(total * rate * 100) / 100 : undefined,
      };
      const lines = [...(pb.lines || []), line];
      const nextPb = { buyer_name: pb.buyer_name, po_number: pb.po_number, lines };
      await saveFlow(chatId, { awaiting: 'po:line_style', poBuilder: nextPb });
      await sendTelegram(
        token,
        chatId,
        `Added ${line.style_number} × ${line.total}${line.rate ? ` @ ${line.rate}` : ''}.\n` +
          `Send another style number, or type "done" to review the PO.`
      );
    } else if (flow.awaiting === 'commit:order') {
      await clearFlow(chatId);
      const order = findOrder(await fetchOrders(), text);
      if (!order) {
        await sendTelegram(token, chatId, `Order "${text}" not found.`, MAIN_MENU);
      } else {
        const lines = buildCommitLines(order);
        const total = lines.reduce((a, l) => a + l.qty, 0);
        if (!total) {
          await sendTelegram(token, chatId, `${formatOrderNumber(order)} has no completed pieces to commit yet.`, MAIN_MENU);
        } else {
          const preview = lines
            .slice(0, 12)
            .map((l) => `  • ${l.color} ${l.size}: ${l.qty}`)
            .join('\n');
          await sendTelegram(
            token,
            chatId,
            `📥 Commit ${total} piece(s) from ${formatOrderNumber(order)} into inventory?\n${preview}` +
              (lines.length > 12 ? `\n  …and ${lines.length - 12} more` : ''),
            {
              inline_keyboard: [
                [
                  { text: '✅ Commit to inventory', callback_data: `commitgo:${order.id}` },
                  { text: '❌ Cancel', callback_data: 'menu' },
                ],
              ],
            }
          );
        }
      }
    } else if (flow.awaiting === 'stock:style') {
      await clearFlow(chatId);
      await runStockLookup(token, chatId, text);
    } else if (flow.awaiting === 'note:order') {
      const note = flow.pendingNote || '';
      const images = flow.pendingImages || [];
      await clearFlow(chatId);
      const order = findOrder(await fetchOrders(), text);
      if (!order) {
        await sendTelegram(token, chatId, `Order "${text}" not found. Start again from the menu.`, MAIN_MENU);
      } else {
        const english = note ? await toEnglishNote(note) : (images.length ? '📷 Photo update' : '');
        const attachments = images.map((u) => ({ url: u, name: 'photo' }));
        await addOrderLog(order.id, 'MANUAL_UPDATE', english, 'Telegram', attachments);
        await sendTelegram(
          token,
          chatId,
          `📝 Added to ${formatOrderNumber(order)}'s timeline${images.length ? ' (with photo)' : ''}:\n"${english}"`,
          MAIN_MENU
        );
      }
    } else if (flow.awaiting === 'ai') {
      // User explicitly chose "Ask AI" — answer this one question, then reset.
      await clearFlow(chatId);
      await aiAssistantReply(token, chatId, text);
    } else {
      // No pending step. If it clearly reads like an order/material update, act
      // on it. Otherwise DON'T call the AI — just show the menu. AI answers are
      // opt-in via the "Ask AI" action so casual messages (e.g. "Hi") are free.
      if (
        /\d/.test(text) &&
        (mapStatusWord(text) || mapMaterialStageWord(text) || looksLikeMaterial(text) || SUBPROCESS_WORDS.test(text))
      ) {
        await handleSpokenUpdate(token, chatId, text);
      } else {
        await sendMenu(token, chatId, 'Tap an option below. To ask a question, choose "\ud83e\udd16 Ask AI a question".');
      }
    }
  } catch (e: any) {
    await sendTelegram(token, chatId, `Error: ${e.message}`);
  }

  return res.status(200).json({ ok: true });
}
