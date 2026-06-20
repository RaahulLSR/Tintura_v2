// =====================================================================
// TINTURA BOT — transport-agnostic brain for the Tintura-Bot chat tab.
// Reuses the SAME data layer (services/db) as the Telegram webhook so the
// in-app bot behaves identically (same menu, same role gating, same data).
// Stateless: the chat client sends { role, action?, text?, awaiting? } and
// gets back { reply, buttons, awaiting }.
// =====================================================================
import {
  fetchOrders,
  fetchProcurements,
  fetchStockLevels,
  fetchStyleByNumber,
  updateOrderStatus,
  advanceProcurement,
  addOrderLog,
  upsertStyle,
  createSalesOrder,
  fetchBuyers,
  fetchSalesOrders,
  createProcurement,
  commitOrderStock,
} from '../services/db.js';
import {
  OrderStatus,
  formatOrderNumber,
  getNextOrderStatus,
  MaterialStage,
  MATERIAL_STAGE_ORDER,
  MATERIAL_STAGE_LABEL,
  procurementStageQty,
  getStylePoster,
  getStyleMainImage,
  getSizeKeyFromLabel,
  prevMaterialStage,
  POSTER_KEY,
  CUSTOM_KEY,
} from '../types.js';
import type { Order, Style, MaterialProcurement, Attachment, SalesOrderLine, SalesOrder, ConsumptionType, StockCommitLine } from '../types.js';
import { BOT_ACTIONS, allowedBotActions } from '../services/botAccess.js';

type Lang = 'en' | 'ta' | 'tang';
type Btn = { label: string; action: string };
type Reply = { reply: string; buttons?: Btn[]; awaiting?: string | null; card?: any };

const MENU_BTN: Btn = { label: '⬅️ Menu', action: 'menu' };

// Public base URL of the ERP (serves the standalone /api/tech-pack page).
const ERP_BASE = (process.env.ERP_BASE_URL || 'https://tintura-sst.vercel.app').replace(/\/+$/, '');

// The production-order pipeline, in order, for the visual stepper.
const STATUS_FLOW: OrderStatus[] = [
  OrderStatus.ASSIGNED,
  OrderStatus.IN_PROGRESS,
  OrderStatus.QC,
  OrderStatus.QC_APPROVED,
  OrderStatus.PACKED,
  OrderStatus.COMPLETED,
];

// ---------- Localisation (English / Tamil / Tanglish) ----------
const T: Record<string, Record<Lang, string>> = {
  menuIntro: {
    en: "Hi 👋 I'm Tintura Bot. Tap an option below.",
    ta: 'வணக்கம் 👋 நான் டிந்துரா பாட். கீழே ஒன்றைத் தேர்ந்தெடுங்கள்.',
    tang: 'Hi 👋 Naan Tintura Bot. Keezha oru option tap pannunga.',
  },
  tapOption: {
    en: 'Tap an option below.',
    ta: 'கீழே ஒன்றைத் தேர்ந்தெடுங்கள்.',
    tang: 'Keezha oru option tap pannunga.',
  },
  noAccess: {
    en: "🔒 Your role can't use that. Here's what you can do:",
    ta: '🔒 உங்கள் பணிக்கு அந்த அனுமதி இல்லை. நீங்கள் செய்யக்கூடியவை:',
    tang: "🔒 Unga role-ku adhuku access illa. Neenga panna mudiyaradhu:",
  },
  askOrder: {
    en: 'Send the order number to see its status & actions.',
    ta: 'ஆர்டர் எண்ணை அனுப்புங்கள் — நிலை & செயல்களைக் காண.',
    tang: 'Order number anuppunga — status & actions paaka.',
  },
  askSummary: {
    en: 'Send the style number for a quick summary.',
    ta: 'ஸ்டைல் எண்ணை அனுப்புங்கள் — விரைவு சுருக்கம்.',
    tang: 'Style number anuppunga — quick summary ku.',
  },
  askFiles: {
    en: 'Send the style number to get its tech-pack files.',
    ta: 'ஸ்டைல் எண்ணை அனுப்புங்கள் — டெக்-பேக் கோப்புகள்.',
    tang: 'Style number anuppunga — tech-pack files ku.',
  },
  askMeasure: {
    en: 'Send the style number to get its measurement chart.',
    ta: 'ஸ்டைல் எண்ணை அனுப்புங்கள் — அளவு விவரப் பட்டியல்.',
    tang: 'Style number anuppunga — measurement chart ku.',
  },
  askStock: {
    en: '🔎 Send the style number to see its on-hand stock.',
    ta: '🔎 ஸ்டைல் எண்ணை அனுப்புங்கள் — கையிருப்பு ஸ்டாக்.',
    tang: '🔎 Style number anuppunga — on-hand stock paaka.',
  },
  askMatOrder: {
    en: 'Send the order number to see its materials.',
    ta: 'ஆர்டர் எண்ணை அனுப்புங்கள் — அதன் மெட்டீரியல்ஸ்.',
    tang: 'Order number anuppunga — adhoda materials paaka.',
  },
  voiceListening: {
    en: '🎙️ Got it, listening…',
    ta: '🎙️ கேட்கிறேன்…',
    tang: '🎙️ Sari, kekkiren…',
  },
  voiceFail: {
    en: "Sorry, I couldn't understand that. Try again or use the menu.",
    ta: 'மன்னிக்கவும், புரியவில்லை. மீண்டும் முயற்சிக்கவும் அல்லது மெனுவைப் பயன்படுத்தவும்.',
    tang: 'Sorry, puriyala. Marupadiyum try pannunga illa menu use pannunga.',
  },
  whichOrderNote: {
    en: 'Which order is this for? Send the order number.',
    ta: 'இது எந்த ஆர்டருக்கு? ஆர்டர் எண்ணை அனுப்புங்கள்.',
    tang: 'Idhu edha order ku? Order number anuppunga.',
  },
  poIntro: {
    en: '🧾 Raise a new PO. Fill the table below, then tap Submit.',
    ta: '🧾 புதிய PO உருவாக்கவும். கீழே உள்ள அட்டவணையை நிரப்பி Submit தட்டவும்.',
    tang: '🧾 New PO podu. Keezha table-a fill panni Submit tap pannunga.',
  },
  uploadAskStyle: {
    en: 'Which style number should I attach this to? Send the style number.',
    ta: 'இதை எந்த ஸ்டைல் எண்ணுடன் இணைக்க வேண்டும்? ஸ்டைல் எண்ணை அனுப்புங்கள்.',
    tang: 'Idha edha style number kooda attach pannanum? Style number anuppunga.',
  },
  uploadSendNow: {
    en: '📎 Now send the photo(s) or file(s) to attach.',
    ta: '📎 இப்போது இணைக்க வேண்டிய புகைப்படம்/கோப்பை அனுப்புங்கள்.',
    tang: '📎 Ippo attach panna photo/file anuppunga.',
  },
};
const L = (lang: Lang, key: string): string => T[key]?.[lang] ?? T[key]?.en ?? key;

// Localised labels for the main-menu buttons (keyed by action).
const ACTION_LABELS: Record<string, Record<Lang, string>> = {
  'act:orders': { en: '📦 Active orders', ta: '📦 செயலில் உள்ள ஆர்டர்கள்', tang: '📦 Active orders' },
  'act:order': { en: '🔧 Order status & actions', ta: '🔧 ஆர்டர் நிலை & செயல்கள்', tang: '🔧 Order status & actions' },
  'act:daily': { en: '📊 Daily summary', ta: '📊 தினசரி சுருக்கம்', tang: '📊 Indiya summary' },
  'act:stock': { en: '🔎 Inventory lookup', ta: '🔎 இன்வென்டரி தேடல்', tang: '🔎 Inventory paaru' },
  'act:summary': { en: '🧾 Style summary', ta: '🧾 ஸ்டைல் சுருக்கம்', tang: '🧾 Style summary' },
  'act:files': { en: '📄 Tech Pack files', ta: '📄 டெக் பேக் கோப்புகள்', tang: '📄 Tech pack files' },
  'act:measure': { en: '📐 Measurement chart', ta: '📐 அளவு பட்டியல்', tang: '📐 Measurement chart' },
  'act:matorder': { en: '🧵 Order materials', ta: '🧵 ஆர்டர் மெட்டீரியல்ஸ்', tang: '🧵 Order materials' },
  'act:newmat': { en: '🆕 New material request', ta: '🆕 புதிய மெட்டீரியல் கோரிக்கை', tang: '🆕 New material request' },
  'act:newpo': { en: '🧾 Raise PO (new sale)', ta: '🧾 புதிய PO உருவாக்கு', tang: '🧾 New PO podu' },
  'act:popdf': { en: '📑 Send a PO PDF', ta: '📑 PO PDF அனுப்பு', tang: '📑 PO PDF anuppu' },
  'act:completionpdf': { en: '📄 Order completion report', ta: '📄 ஆர்டர் முடிவு அறிக்கை', tang: '📄 Order completion report' },
  'act:commit': { en: '📥 Commit stock to inventory', ta: '📥 ஸ்டாக் இன்வென்டரிக்கு', tang: '📥 Stock-a inventory ku' },
  'act:upload': { en: '📎 Add files to a style', ta: '📎 ஸ்டைலுக்கு கோப்பு சேர்', tang: '📎 Style ku files add' },
  'act:reqadd': { en: '➕ Add quantity / requirement', ta: '➕ அளவு / தேவை சேர்', tang: '➕ Quantity / requirement add' },
  'act:voice': { en: '🎙️ Voice / text update', ta: '🎙️ குரல் / உரை அப்டேட்', tang: '🎙️ Voice / text update' },
  'act:ai': { en: '🤖 Ask AI a question', ta: '🤖 AI யிடம் கேள்வி', tang: '🤖 AI kitta kelvi kelu' },
};
const actionLabel = (key: string, lang: Lang, fallback: string): string =>
  ACTION_LABELS[key]?.[lang] ?? fallback;

// ---------- AI / transcription (only used to turn a spoken note into text) ----------
const GEMINI_KEY =
  process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL = process.env.VITE_GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GROQ_KEY = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY || process.env.GROQ_KEY || '';

const fetchBytes = async (url: string): Promise<{ buf: Buffer; mime: string } | null> => {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return { buf: Buffer.from(ab), mime: r.headers.get('content-type') || '' };
  } catch {
    return null;
  }
};

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
                  'Listen to this voice note. It may be in Tamil, English, or Tanglish ' +
                  '(Tamil spoken with English words / written in Latin script). ' +
                  'Translate the meaning into clear, natural English and return ONLY the English text. ' +
                  'Keep order numbers, material names, quantities and any English words exactly as spoken.',
              },
              { inline_data: { mime_type: mime || 'audio/webm', data: buf.toString('base64') } },
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

const transcribeWithGroq = async (buf: Buffer, mime: string): Promise<string | null> => {
  if (!GROQ_KEY) return null;
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: mime || 'audio/webm' }), 'voice.webm');
    form.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3');
    // Use the translations endpoint so Tamil/Tanglish audio comes back as English.
    const tr = await fetch('https://api.groq.com/openai/v1/audio/translations', {
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

const transcribeUrl = async (mediaUrl: string): Promise<string | null> => {
  const dl = await fetchBytes(mediaUrl);
  if (!dl) return null;
  return (await transcribeWithGemini(dl.buf, dl.mime)) || (await transcribeWithGroq(dl.buf, dl.mime));
};

// ---------- Heuristic spoken-update parsing (regex; matches the Telegram bot) ----------
const COMPLETION_RE = /complete|completed|finish|finished|\bdone\b|over\b|mudin|mudich|aach|aagid|aayid/i;
const SUBPROCESS_WORDS =
  /iron(ing)?|press(ing)?|wash(ing)?|embroider|print(ing)?|fus(ing)?|kaja|button.?hole|steam|mend(ing)?|bartack|overlock|hemming|tailor|finishing|loading|sticker|tag(ging)?|folding|measure(ment)?|sampl(e|ing)/i;

const mapStatusWord = (text: string): OrderStatus | undefined => {
  const t = text || '';
  const dispatch = /dispatch|deliver|shipp?ed|shipment|courier|hand.?over|handed.?over/i.test(t);
  const hasPack = /pack(ing|ed)?/i.test(t);
  const hasQc = /\bq\.?c\b|checking|inspection|quality/i.test(t);
  const qcPass = /pass|approv|qc.?ok|cleared|\bok\b/i.test(t);
  const hasProd = /cutting|cut\b|stitch|sew|tailor|production|running|in.?progress|\bwip\b|\bstart|\bbegin/i.test(t);
  const hasAssign = /assign/i.test(t);
  const completed = COMPLETION_RE.test(t);
  if (dispatch) return OrderStatus.COMPLETED;
  if (hasPack) return OrderStatus.PACKED;
  if (hasQc) return qcPass || completed ? OrderStatus.QC_APPROVED : OrderStatus.QC;
  if (qcPass) return OrderStatus.QC_APPROVED;
  if (hasProd) return OrderStatus.IN_PROGRESS;
  if (hasAssign) return OrderStatus.ASSIGNED;
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
const looksLikeMaterial = (text: string): boolean =>
  /material|procure|thread|fabric|cloth|button|zip(per)?|elastic|label|trim|cone|yarn|dyeing|accessor|invoice|stock|raw\s*material|cotton|lining|tape|velcro/i.test(text);

type ParsedUpdate = { kind: 'order' | 'material'; order_number?: string; material?: string; status?: OrderStatus; stage?: MaterialStage };
const parseUpdate = (text: string): ParsedUpdate => ({
  kind: looksLikeMaterial(text) ? 'material' : 'order',
  order_number: (text.match(/\d{2,}/) || [])[0],
  status: mapStatusWord(text),
  stage: mapMaterialStageWord(text),
});

// ---------- Attach an uploaded file to a style (poster gallery / general files) ----------
const attachFileToStyle = async (styleNumber: string, att: Attachment): Promise<boolean> => {
  const style = await fetchStyleByNumber((styleNumber || '').split(' - ')[0].trim());
  if (!style) return false;
  const tp: any = { ...(style.tech_pack || {}) };
  if (att.type === 'image') {
    const poster = tp[POSTER_KEY] && Array.isArray(tp[POSTER_KEY].images) ? tp[POSTER_KEY] : { images: [] };
    const images = [...poster.images, att];
    tp[POSTER_KEY] = { images, mainUrl: poster.mainUrl || images[0]?.url };
  } else {
    const custom = tp[CUSTOM_KEY] && typeof tp[CUSTOM_KEY] === 'object' ? { ...tp[CUSTOM_KEY] } : {};
    const existing = custom['General files'] && typeof custom['General files'] === 'object' ? custom['General files'] : { text: '', attachments: [] };
    custom['General files'] = { ...existing, attachments: [...(existing.attachments || []), att] };
    tp[CUSTOM_KEY] = custom;
  }
  const { error } = await upsertStyle({ ...style, tech_pack: tp });
  return !error;
};

const findOrder = (orders: Order[], ref: string): Order | undefined => {
  const digits = (ref || '').replace(/\D/g, '');
  if (!digits) return undefined;
  return orders.find((o) => {
    const formatted = formatOrderNumber(o).replace(/\D/g, '');
    const raw = (o.order_no || '').replace(/\D/g, '');
    return formatted.endsWith(digits) || raw === digits || raw.endsWith(digits);
  });
};

const procStageLine = (p: MaterialProcurement): string => {
  const parts = MATERIAL_STAGE_ORDER.filter((s) => procurementStageQty(p, s) > 0).map(
    (s) => `${MATERIAL_STAGE_LABEL[s]} ${procurementStageQty(p, s)}`
  );
  return parts.join(' · ') || 'no qty';
};

// ---------- The role-filtered main menu (identical labels to Telegram) ----------
const buildMenu = (role: string | null, lang: Lang, intro?: string): Reply => {
  const allowed = new Set(allowedBotActions(role));
  const buttons = BOT_ACTIONS.filter((a) => allowed.has(a.key)).map((a) => ({
    label: actionLabel(a.key, lang, a.label),
    action: a.key,
  }));
  return { reply: intro || L(lang, 'tapOption'), buttons, awaiting: null };
};

// ---------- Read runners (mirror the Telegram bot) ----------
const runActiveOrders = async (): Promise<Reply> => {
  const orders = await fetchOrders();
  const active = orders.filter((o) => o.status !== OrderStatus.COMPLETED);
  if (!active.length) return { reply: 'There are no active orders right now.', buttons: [MENU_BTN] };
  const today = new Date().toISOString().slice(0, 10);
  const shown = active.slice(0, 30);
  const items = shown.map((o) => ({
    id: o.id,
    no: formatOrderNumber(o),
    style: (o.style_number || '').split(' - ')[0],
    qty: o.quantity,
    status: o.status,
    target: o.target_delivery_date || '',
    overdue: !!(o.target_delivery_date && o.target_delivery_date < today),
    progress: Math.max(0, STATUS_FLOW.indexOf(o.status as OrderStatus)) / (STATUS_FLOW.length - 1),
  }));
  const buttons = shown.map((o) => ({
    label: `📦 ${formatOrderNumber(o)} · ${(o.style_number || '').split(' - ')[0]} · ${o.status}`.slice(0, 60),
    action: `ocard:${o.id}`,
  }));
  buttons.push(MENU_BTN);
  return {
    reply: `📋 ${active.length} active order(s)${active.length > shown.length ? ` (showing ${shown.length})` : ''} — tap one:`,
    card: { type: 'orders', items },
    buttons,
  };
};

const orderCard = (order: Order): Reply => {
  const next = getNextOrderStatus(order.status);
  const curIdx = STATUS_FLOW.indexOf(order.status as OrderStatus);
  const today = new Date().toISOString().slice(0, 10);
  const reply =
    `📦 ${formatOrderNumber(order)}\n` +
    `Style: ${order.style_number}\n` +
    `Qty: ${order.quantity}\n` +
    `Status: ${order.status}\n` +
    `Target: ${order.target_delivery_date || '—'}`;
  const actions: Btn[] = [];
  if (next) actions.push({ label: `▶️ Advance to ${next}`, action: `adv:${order.id}` });
  actions.push({ label: '🧵 Materials', action: `omat:${order.id}` });
  actions.push({ label: '🧾 Summary', action: `osum:${order.id}` });
  actions.push({ label: '📄 Files', action: `ofiles:${order.id}` });
  const card = {
    type: 'order',
    id: order.id,
    no: formatOrderNumber(order),
    style: order.style_number,
    qty: order.quantity,
    status: order.status,
    target: order.target_delivery_date || '',
    overdue: !!(order.target_delivery_date && order.target_delivery_date < today && order.status !== OrderStatus.COMPLETED),
    steps: STATUS_FLOW.map((s, i) => ({ label: s, done: i < curIdx, current: i === curIdx })),
    actions,
  };
  return { reply, card, buttons: [...actions, MENU_BTN] };
};

const runOrderStatus = async (ref: string): Promise<Reply> => {
  const orders = await fetchOrders();
  const order = findOrder(orders, ref);
  if (!order) return { reply: `Order "${ref}" not found.`, buttons: [MENU_BTN] };
  return orderCard(order);
};

const advanceOrder = async (id: string): Promise<Reply> => {
  const orders = await fetchOrders();
  const order = orders.find((o) => o.id === id);
  if (!order) return { reply: 'That order no longer exists.', buttons: [MENU_BTN] };
  const next = getNextOrderStatus(order.status);
  if (!next) return { reply: `${formatOrderNumber(order)} is already at its final stage (${order.status}).`, buttons: [MENU_BTN] };
  try {
    await updateOrderStatus(order.id, next);
    return { reply: `✅ ${formatOrderNumber(order)} advanced to ${next}.`, buttons: [{ label: '📦 Open order', action: `ocard:${order.id}` }, MENU_BTN] };
  } catch (e: any) {
    return { reply: `Could not advance order: ${e?.message || 'unknown error'}.`, buttons: [MENU_BTN] };
  }
};

const styleSummary = (style: Style): Reply => {
  const colors = (style.available_colors || []).filter(Boolean).join(', ') || '—';
  const sizes = (style.available_sizes || []).join(', ') || '—';
  const reply =
    `🧾 Style ${style.style_number}\n` +
    `Category: ${style.category || '—'}\n` +
    `Garment: ${style.garment_type || '—'}\n` +
    `Segment: ${style.demographic || '—'}\n` +
    `Colors: ${colors}\n` +
    `Sizes (${style.size_type || ''}): ${sizes}\n` +
    `Packing: ${style.packing_type || '—'} (${style.pcs_per_box ?? '—'} pcs/box)` +
    (style.style_text ? `\n\nNotes: ${style.style_text}` : '');
  return { reply, buttons: [MENU_BTN] };
};

const runStyleSummary = async (ref: string): Promise<Reply> => {
  const style = await fetchStyleByNumber((ref || '').split(' - ')[0].trim());
  if (!style) return { reply: `Style "${ref}" not found.`, buttons: [MENU_BTN] };
  return styleSummary(style);
};

const runStyleFiles = async (ref: string): Promise<Reply> => {
  const style = await fetchStyleByNumber((ref || '').split(' - ')[0].trim());
  if (!style) return { reply: `Style "${ref}" not found.`, buttons: [MENU_BTN] };
  const pdfUrl = `${ERP_BASE}/api/tech-pack?style=${encodeURIComponent(style.style_number)}`;
  const card = {
    type: 'techpack',
    styleNumber: style.style_number,
    category: style.category,
    garmentType: style.garment_type || '',
    image: getStyleMainImage(style) || '',
    pdfUrl,
  };
  return {
    reply: `📄 Tech-Pack PDF for style ${style.style_number}.`,
    card,
    buttons: [MENU_BTN],
  };
};

const runDailySummary = async (): Promise<Reply> => {
  const [orders, procs] = await Promise.all([fetchOrders(), fetchProcurements()]);
  const byStatus: Record<string, number> = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  const today = new Date().toISOString().slice(0, 10);
  const dueToday = orders.filter((o) => (o.target_delivery_date || '') === today && o.status !== OrderStatus.COMPLETED);
  const overdue = orders.filter((o) => o.target_delivery_date && o.target_delivery_date < today && o.status !== OrderStatus.COMPLETED);
  const stageQty: Record<string, number> = {};
  for (const p of procs) {
    for (const st of MATERIAL_STAGE_ORDER) {
      const q = procurementStageQty(p, st);
      if (q > 0) stageQty[st] = (stageQty[st] || 0) + q;
    }
  }
  const statusLines = Object.entries(byStatus).map(([s, n]) => `  • ${s}: ${n}`).join('\n') || '  • none';
  const stageLines = MATERIAL_STAGE_ORDER.filter((s) => stageQty[s]).map((s) => `  • ${MATERIAL_STAGE_LABEL[s]}: ${stageQty[s]}`).join('\n') || '  • none pending';
  const reply =
    `📊 Daily summary — ${today}\n\n` +
    `Orders (${orders.length} total):\n${statusLines}\n\n` +
    `Due today: ${dueToday.length}\nOverdue: ${overdue.length}\n\n` +
    `Materials in pipeline:\n${stageLines}`;
  const card = {
    type: 'daily',
    date: today,
    tiles: [
      { label: 'Total orders', value: orders.length, tone: 'blue' },
      { label: 'Active', value: orders.filter((o) => o.status !== OrderStatus.COMPLETED).length, tone: 'amber' },
      { label: 'Due today', value: dueToday.length, tone: dueToday.length ? 'amber' : 'green' },
      { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'red' : 'green' },
    ],
    statusBars: STATUS_FLOW.filter((s) => byStatus[s]).map((s) => ({ label: s, value: byStatus[s] })),
    pipeline: MATERIAL_STAGE_ORDER.filter((s) => stageQty[s]).map((s) => ({ label: MATERIAL_STAGE_LABEL[s], value: stageQty[s] })),
  };
  return { reply, card, buttons: [{ label: '📦 Active orders', action: 'act:orders' }, MENU_BTN] };
};

const runStockLookup = async (ref: string): Promise<Reply> => {
  const styleNo = (ref || '').split(' - ')[0].trim();
  const levels = await fetchStockLevels();
  const mine = levels.filter((l) => (l.style_number || '').toLowerCase() === styleNo.toLowerCase());
  if (!mine.length) return { reply: `No on-hand stock recorded for style "${styleNo}".`, buttons: [MENU_BTN] };
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
      const cells = rows.filter((r) => r.qty).map((r) => `    ${r.size}: ${r.qty}`).join('\n');
      return `🎨 ${color} (${sub})\n${cells || '    —'}`;
    })
    .join('\n');
  const card = {
    type: 'stock',
    style: styleNo,
    total,
    colors: Object.entries(byColor).map(([color, rows]) => ({
      color,
      total: rows.reduce((a, r) => a + r.qty, 0),
      sizes: rows.filter((r) => r.qty).map((r) => ({ size: r.size, qty: r.qty })),
    })),
  };
  return { reply: `🔎 Stock for ${styleNo} — total ${total}\n\n${blocks}`, card, buttons: [MENU_BTN] };
};

const runOrderMaterials = async (ref: string): Promise<Reply> => {
  const orders = await fetchOrders();
  const order = findOrder(orders, ref);
  if (!order) return { reply: `Order "${ref}" not found.`, buttons: [MENU_BTN] };
  const procs = (await fetchProcurements()).filter((p) => String(p.order_id) === String(order.id));
  if (!procs.length) return { reply: `No materials are linked to ${formatOrderNumber(order)} yet.`, buttons: [MENU_BTN] };
  const lines = procs.map((p) => `🧵 ${p.material_name} — ${procStageLine(p)}`).join('\n');
  return { reply: `🧵 Materials for ${formatOrderNumber(order)}:\n${lines}`, buttons: [MENU_BTN] };
};

// Order-card sub-actions that resolve the order's style first.
const styleForOrder = async (orderId: string): Promise<Style | null> => {
  const order = (await fetchOrders()).find((o) => o.id === orderId);
  if (!order) return null;
  return fetchStyleByNumber((order.style_number || '').split(' - ')[0].trim());
};

// ---------- Prompts for flows that still complete in the full app / Telegram ----------
const flowPrompt = (intro: string): Reply => ({ reply: `${intro}`, buttons: [MENU_BTN] });
void flowPrompt;

// ---------- Ask AI: one-shot question answered from a live data snapshot ----------
const runAi = async (lang: Lang, question: string): Promise<Reply> => {
  const q = (question || '').trim();
  if (!q) return { reply: '🤖 Ask me anything about your orders, materials, stock or sales.', awaiting: 'ai' };
  if (!GEMINI_KEY) {
    return { reply: "I can't answer free-text questions yet \u2014 no AI key is configured. Tap an option instead.", buttons: [MENU_BTN] };
  }
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
      .map(([s, qn]) => `${s}: ${qn}`)
      .join('\n');
    const salesCtx = (sales as any[])
      .slice(0, 30)
      .map((s) => `${s.po_number} buyer:${s.buyer_name} qty:${s.total_qty} status:${s.status}`)
      .join('\n');
    const context =
      `ORDERS:\n${orderCtx || '(none)'}\n\nMATERIALS:\n${procCtx || '(none)'}\n\n` +
      `INVENTORY (style: units):\n${stockCtx || '(none)'}\n\nSALES POs:\n${salesCtx || '(none)'}`;
    const langLine =
      lang === 'ta'
        ? 'Answer in Tamil.'
        : lang === 'tang'
        ? 'Answer in Tanglish (Tamil written in English letters).'
        : 'Answer in English.';
    const prompt =
      'You are the Tintura factory assistant. Answer the user\'s question briefly using ONLY the data ' +
      "snapshot below. If the answer is not in the data, say you don't have that info and suggest tapping the menu. " +
      `Keep it short. ${langLine}\n\nDATA SNAPSHOT:\n${context.slice(0, 6000)}\n\nQUESTION: ${q}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
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
    return {
      reply: answer || "I couldn't find an answer in the current data.",
      awaiting: 'ai',
      buttons: [{ label: '🤖 Ask another', action: 'act:ai' }, MENU_BTN],
    };
  } catch (e: any) {
    return { reply: `Sorry, I couldn't answer that: ${e?.message || 'error'}.`, buttons: [MENU_BTN] };
  }
};

// ---------- Add per-piece requirement to a style (act:reqadd) ----------
const REQ_CATEGORY = 'Production Requirements';
type ParsedRequirement = { name: string; val: number; type: ConsumptionType; unit?: string; colors?: string[] };

const extractColors = (raw: string): { colors: string[]; cleaned: string } => {
  const t = raw;
  const splitColors = (s: string) =>
    s.split(/[,/&]|\band\b/i).map((c) => c.trim()).filter(Boolean).map((c) => c.replace(/\b\w/g, (ch) => ch.toUpperCase())).slice(0, 12);
  const patterns = [
    /\bonly\s+for\s+colou?rs?\s+([a-z][a-z\s,/&]+?)\s*$/i,
    /\bfor\s+colou?rs?\s+([a-z][a-z\s,/&]+?)\s*$/i,
    /\bcolou?rs?\s*[:=]\s*([a-z][a-z\s,/&]+?)\s*$/i,
    /\bonly\s+for\s+([a-z][a-z\s,/&]+?)\s*$/i,
    /\bin\s+colou?r\s+([a-z][a-z\s,/&]+?)\s*$/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return { colors: splitColors(m[1]), cleaned: t.slice(0, m.index).trim() };
  }
  return { colors: [], cleaned: t };
};

const parseRequirementText = (raw: string): ParsedRequirement | null => {
  const colorRes = extractColors((raw || '').trim());
  const t = colorRes.cleaned.trim();
  if (!t) return null;
  const numMatch = t.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const perN = t.match(/(?:for|per|makes?|gives?|=)\s*(\d{2,})\s*(?:pcs?|pieces?|garments?)\b/i);
  let type: ConsumptionType = 'items_per_pc';
  let val = parseFloat(numMatch[1]);
  if (perN) { type = 'pcs_per_item'; val = parseFloat(perN[1]); }
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

const aiParseRequirement = async (raw: string): Promise<ParsedRequirement | null> => {
  if (!GEMINI_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const prompt =
      'Extract a per-piece material requirement from this short factory phrase (Tamil / English / Tanglish). Fields:\n' +
      '- name: the material/component name.\n- val: the numeric quantity.\n' +
      '- type: "items_per_pc" when it is amount of material per ONE garment; "pcs_per_item" when one unit of material makes several garments (e.g. "1 cone for 50 pieces" => val 50).\n' +
      '- colors: array of colour names if the requirement is ONLY for specific colours; empty array otherwise.\n' +
      'Reply ONLY JSON: {"name":"","val":0,"type":"items_per_pc","colors":[]}.\n\nPhrase: ' + raw;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rawJson = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join('').trim();
    const parsed = JSON.parse(rawJson);
    const val = Number(parsed.val);
    if (!val || !isFinite(val)) return null;
    const type: ConsumptionType = parsed.type === 'pcs_per_item' ? 'pcs_per_item' : 'items_per_pc';
    const name = String(parsed.name || 'Material').slice(0, 60) || 'Material';
    const colors = Array.isArray(parsed.colors) ? parsed.colors.map((c: any) => String(c).trim()).filter(Boolean).slice(0, 12) : [];
    return { name, val, type, colors };
  } catch {
    return null;
  }
};

const requirementSummary = (req: ParsedRequirement): string => {
  const base = req.type === 'items_per_pc' ? `${req.val}${req.unit ? ' ' + req.unit : ''} per piece` : `1 ${req.unit || 'unit'} per ${req.val} pieces`;
  const scope = req.colors && req.colors.length ? ` (only ${req.colors.join('/')})` : ' (whole style)';
  return base + scope;
};

const addProductionRequirement = async (styleNumber: string, req: ParsedRequirement): Promise<boolean> => {
  const style = await fetchStyleByNumber(styleNumber.split(' - ')[0].trim());
  if (!style) return false;
  const tp: any = { ...(style.tech_pack || {}) };
  const cat = tp[REQ_CATEGORY] && typeof tp[REQ_CATEGORY] === 'object' ? { ...tp[REQ_CATEGORY] } : {};
  const existing = cat[req.name] && typeof cat[req.name] === 'object' ? cat[req.name] : { text: '', attachments: [] as Attachment[] };
  const colors = (req.colors || []).filter(Boolean);
  if (colors.length) {
    const variants: any[] = Array.isArray(existing.variants) ? [...existing.variants] : [];
    const idx = variants.findIndex((v) => (v.colors || []).map((c: string) => c.toLowerCase()).sort().join('/') === [...colors].map((c) => c.toLowerCase()).sort().join('/'));
    const baseVariant = idx >= 0 ? variants[idx] : { colors, text: '', attachments: [] as Attachment[] };
    const merged = { ...baseVariant, colors, attachments: baseVariant.attachments || [], consumption_type: req.type, consumption_val: req.val };
    if (idx >= 0) variants[idx] = merged; else variants.push(merged);
    cat[req.name] = { ...existing, attachments: existing.attachments || [], variants };
  } else {
    cat[req.name] = { ...existing, attachments: existing.attachments || [], consumption_type: req.type, consumption_val: req.val };
  }
  tp[REQ_CATEGORY] = cat;
  const { error } = await upsertStyle({ ...style, tech_pack: tp });
  return !error;
};

const runRequirementLine = async (styleNumber: string, text: string): Promise<Reply> => {
  let parsed = parseRequirementText(text);
  if (!parsed) parsed = await aiParseRequirement(text);
  if (!parsed) {
    return {
      reply: 'Could not read a quantity there. Try e.g. "Main fabric 1.2 meter", "Buttons 6 per piece", "1 cone for 50 pieces", or "Lining 1.1 meter only for Red".',
      awaiting: `req:line:${encodeURIComponent(styleNumber)}`,
      buttons: [MENU_BTN],
    };
  }
  const ok = await addProductionRequirement(styleNumber, parsed);
  return {
    reply: ok
      ? `✅ ${styleNumber}: "${parsed.name}" → ${requirementSummary(parsed)}.\nSend the next requirement, or tap Menu when done.`
      : 'Saved the values but could not update the style. Please try again.',
    awaiting: `req:line:${encodeURIComponent(styleNumber)}`,
    buttons: [MENU_BTN],
  };
};

// ---------- New material request (act:newmat) ----------
const runNewMaterial = async (orderId: string, styleNumber: string, material: string, qtyText: string): Promise<Reply> => {
  const qty = Number((qtyText.match(/[\d.]+/) || [])[0] || 0);
  if (!qty || qty <= 0) return { reply: 'That quantity was not a positive number. Start again from the menu.', buttons: [MENU_BTN] };
  try {
    const proc = await createProcurement({
      order_id: orderId || undefined,
      style_number: (styleNumber || '').split(' - ')[0] || '',
      material_name: material || 'Material',
      total_quantity: qty,
      startStage: MaterialStage.REQUESTED,
      created_by_name: 'Tintura Chat',
    });
    return { reply: `✅ Raised material request: ${proc.material_name} × ${qty} — stage Requested.`, buttons: [MENU_BTN] };
  } catch (e: any) {
    return { reply: `Could not create the request: ${e?.message || 'error'}.`, buttons: [MENU_BTN] };
  }
};

// ---------- Commit completed pieces to inventory (act:commit) ----------
const buildCommitLines = (order: Order): StockCommitLine[] => {
  const format = order.size_format || 'standard';
  const labels = order.size_sequence && order.size_sequence.length
    ? order.size_sequence
    : format === 'numeric' ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL'];
  const rows: any[] = order.completion_breakdown && order.completion_breakdown.length ? order.completion_breakdown : order.size_breakdown || [];
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

const runCommitPreview = async (ref: string): Promise<Reply> => {
  const order = findOrder(await fetchOrders(), ref);
  if (!order) return { reply: `Order "${ref}" not found.`, buttons: [MENU_BTN] };
  const lines = buildCommitLines(order);
  const total = lines.reduce((a, l) => a + l.qty, 0);
  if (!total) return { reply: `${formatOrderNumber(order)} has no completed pieces to commit yet.`, buttons: [MENU_BTN] };
  const preview = lines.slice(0, 12).map((l) => `• ${l.color} ${l.size}: ${l.qty}`).join('\n');
  return {
    reply: `${formatOrderNumber(order)} — ${total} piece(s) ready to push to inventory:\n${preview}${lines.length > 12 ? '\n…' : ''}`,
    buttons: [{ label: `✅ Commit ${total} pcs`, action: `commitgo:${order.id}` }, MENU_BTN],
  };
};

const runCommitGo = async (orderId: string): Promise<Reply> => {
  const order = (await fetchOrders()).find((o) => o.id === orderId);
  if (!order) return { reply: 'That order no longer exists.', buttons: [MENU_BTN] };
  const lines = buildCommitLines(order);
  if (!lines.length) return { reply: `${formatOrderNumber(order)} has no completed pieces to commit.`, buttons: [MENU_BTN] };
  try {
    await commitOrderStock(order, lines, 'Tintura Chat');
    const total = lines.reduce((a, l) => a + l.qty, 0);
    return { reply: `✅ Pushed ${total} piece(s) from ${formatOrderNumber(order)} into inventory across ${lines.length} colour/size line(s).`, buttons: [MENU_BTN] };
  } catch (e: any) {
    return { reply: `Could not commit stock: ${e?.message || 'error'}.`, buttons: [MENU_BTN] };
  }
};

// ---------- PO PDF (act:popdf) ----------
const runPoPdfList = async (): Promise<Reply> => {
  const pos = await fetchSalesOrders().catch(() => [] as SalesOrder[]);
  if (!pos.length) return { reply: 'No purchase orders found yet. Raise one first with "Raise PO".', buttons: [MENU_BTN] };
  const buttons: Btn[] = pos.slice(0, 10).map((p) => ({ label: `📄 ${p.po_number} · ${p.buyer_name} · ${p.total_qty}pcs`.slice(0, 60), action: `popdf:${p.id}` }));
  buttons.push(MENU_BTN);
  return { reply: '📄 Pick a PO to open its PDF:', buttons };
};

const runPoPdf = async (id: string): Promise<Reply> => {
  const pos = await fetchSalesOrders().catch(() => [] as SalesOrder[]);
  const po = pos.find((p) => String(p.id) === id);
  if (!po) return { reply: 'That PO could not be found. It may have been removed.', buttons: [MENU_BTN] };
  const card = {
    type: 'pdf',
    title: po.po_number,
    subtitle: `${po.buyer_name} · ${po.total_qty} pcs${po.total_amount ? ` · ₹${po.total_amount}` : ''}`,
    pdfUrl: `${ERP_BASE}/api/po-pdf?id=${encodeURIComponent(String(po.id))}`,
    label: '📄 Open PO PDF',
  };
  return { reply: `📄 PO ${po.po_number} — ${po.buyer_name}.`, card, buttons: [MENU_BTN] };
};

// ---------- Completion report PDF (act:completionpdf) ----------
const runCompletionPdfList = async (): Promise<Reply> => {
  const orders = (await fetchOrders().catch(() => [] as any[]))
    .filter((o) => o.status === OrderStatus.COMPLETED);
  if (!orders.length) return { reply: 'No completed orders yet. A report is generated once an order is committed to inventory.', buttons: [MENU_BTN] };
  const buttons: Btn[] = orders.slice(0, 10).map((o) => ({
    label: `📄 ${formatOrderNumber(o)} · ${o.style_number} · ${o.quantity}pcs`.slice(0, 60),
    action: `completionpdf:${o.id}`,
  }));
  buttons.push(MENU_BTN);
  return { reply: '📄 Pick a completed order to open its completion report:', buttons };
};

const runCompletionPdf = async (id: string): Promise<Reply> => {
  const order = (await fetchOrders().catch(() => [] as any[])).find((o) => String(o.id) === id);
  if (!order) return { reply: 'That order could not be found.', buttons: [MENU_BTN] };
  const card = {
    type: 'pdf',
    title: `Completion · ${formatOrderNumber(order)}`,
    subtitle: `${order.style_number} · ${order.quantity} pcs`,
    pdfUrl: `${ERP_BASE}/api/completion-report?id=${encodeURIComponent(String(order.id))}`,
    label: '📄 Open completion report',
  };
  return { reply: `📄 Completion report — ${formatOrderNumber(order)}.`, card, buttons: [MENU_BTN] };
};

const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL', '3XL'];
const NUMERIC_SIZES = ['65', '70', '75', '80', '85', '90'];

// ---------- PO builder (custom-app feature: fill-in table → create a sale) ----------
const runPoForm = async (lang: Lang): Promise<Reply> => {
  const buyers = await fetchBuyers().catch(() => [] as any[]);
  return {
    reply: L(lang, 'poIntro'),
    awaiting: null,
    card: {
      type: 'po-form',
      today: new Date().toISOString().slice(0, 10),
      sizes: STANDARD_SIZES,
      numericSizes: NUMERIC_SIZES,
      buyers: buyers.map((b: any) => b.name).filter(Boolean),
    },
  };
};

const submitPo = async (lang: Lang, po: any, createdBy?: string): Promise<Reply> => {
  try {
    const lines: SalesOrderLine[] = (po?.lines || [])
      .map((l: any) => {
        const sizes: Record<string, number> = {};
        let total = 0;
        for (const [k, v] of Object.entries(l.sizes || {})) {
          const n = Number(v) || 0;
          if (n > 0) { sizes[k] = n; total += n; }
        }
        const rate = Number(l.rate) || 0;
        return {
          style_number: (l.style_number || '').trim(),
          sizes,
          total,
          rate: rate || undefined,
          amount: rate ? total * rate : undefined,
          color: (l.color || '').trim() || undefined,
        } as SalesOrderLine;
      })
      .filter((l: SalesOrderLine) => l.style_number && l.total > 0);
    const sizeLabels = po?.size_format === 'numeric' ? NUMERIC_SIZES : STANDARD_SIZES;
    const created = await createSalesOrder({
      po_number: (po?.po_number || '').trim() || 'auto',
      po_date: po?.po_date || new Date().toISOString().slice(0, 10),
      buyer_name: (po?.buyer_name || '').trim(),
      size_format: po?.size_format === 'numeric' ? 'numeric' : 'standard',
      size_labels: sizeLabels,
      lines,
      note: po?.note || undefined,
      created_by_name: createdBy || undefined,
    });
    return {
      reply: `✅ PO ${created.po_number} created for ${created.buyer_name} — ${created.total_qty} pcs${created.total_amount ? `, ₹${created.total_amount}` : ''}.`,
      card: {
        type: 'po-done',
        po_number: created.po_number,
        buyer: created.buyer_name,
        total_qty: created.total_qty,
        total_amount: created.total_amount,
        lines: created.lines,
        size_labels: created.size_labels,
      },
      buttons: [{ label: '🧾 Raise another PO', action: 'act:newpo' }, MENU_BTN],
    };
  } catch (e: any) {
    return { reply: `Could not create PO: ${e?.message || 'unknown error'}.`, buttons: [{ label: '🔁 Try again', action: 'act:newpo' }, MENU_BTN] };
  }
};

// ---------- Spoken / typed update (voice note → status, note or material move) ----------
const applyMaterialUpdate = async (lang: Lang, transcript: string, parsed: ParsedUpdate, orders: Order[]): Promise<Reply> => {
  if (!parsed.order_number) return { reply: 'Which order is this material for? e.g. "Order 1004 black thread received".', buttons: [MENU_BTN] };
  const order = findOrder(orders, parsed.order_number);
  if (!order) return { reply: `Order "${parsed.order_number}" not found.`, buttons: [MENU_BTN] };
  let procs = (await fetchProcurements()).filter((p) => String(p.order_id) === String(order.id));
  if (!procs.length) return { reply: `No materials linked to ${formatOrderNumber(order)}.`, buttons: [MENU_BTN] };
  if (parsed.material) {
    const kw = parsed.material.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const narrowed = procs.filter((p) => kw.some((w) => p.material_name.toLowerCase().includes(w)));
    if (narrowed.length) procs = narrowed;
  }
  const stage = parsed.stage;
  if (procs.length === 1 && stage) {
    const p = procs[0];
    const from = prevMaterialStage(stage);
    const qty = from ? procurementStageQty(p, from) : 0;
    if (!from || qty <= 0) return { reply: `Nothing at the previous stage to move into ${MATERIAL_STAGE_LABEL[stage]} for ${p.material_name}.`, buttons: [MENU_BTN] };
    if (stage === MaterialStage.ORDERED) {
      return { reply: `Send the invoice number to mark ${p.material_name} (${qty} ${p.unit}) as Ordered.`, awaiting: `inv:${p.id}:${qty}` };
    }
    try { await advanceProcurement(p.id, qty, stage, { created_by_name: 'Tintura Chat' }); }
    catch (e: any) { return { reply: `Could not update: ${e?.message || 'error'}.`, buttons: [MENU_BTN] }; }
    return { reply: `✅ ${p.material_name} ${qty} ${p.unit} → ${MATERIAL_STAGE_LABEL[stage]}.`, buttons: [{ label: '🧵 Order materials', action: `omat:${order.id}` }, MENU_BTN] };
  }
  const lines = procs.map((p) => `🧵 ${p.material_name} — ${procStageLine(p)}`).join('\n');
  return { reply: `Materials for ${formatOrderNumber(order)}:\n${lines}\n\nSay the material name + stage, e.g. "black thread received".`, buttons: [MENU_BTN] };
};

const applySpokenUpdate = async (lang: Lang, transcript: string): Promise<Reply> => {
  const parsed = parseUpdate(transcript);
  const orders = await fetchOrders();
  if (parsed.kind === 'material') return applyMaterialUpdate(lang, transcript, parsed, orders);
  const order = parsed.order_number ? findOrder(orders, parsed.order_number) : undefined;
  const isNote = !parsed.status || SUBPROCESS_WORDS.test(transcript);
  if (isNote) {
    if (order) {
      await addOrderLog(order.id, 'MANUAL_UPDATE', transcript, 'Tintura Chat');
      return { reply: `📝 Added to ${formatOrderNumber(order)}'s timeline.`, buttons: [{ label: '📦 Open order', action: `ocard:${order.id}` }, MENU_BTN] };
    }
    return { reply: L(lang, 'whichOrderNote'), awaiting: `note:${encodeURIComponent(transcript)}` };
  }
  if (order) {
    try { await updateOrderStatus(order.id, parsed.status!); }
    catch (e: any) { return { reply: `Could not update: ${e?.message || 'error'}.`, buttons: [MENU_BTN] }; }
    const fresh = (await fetchOrders()).find((o) => o.id === order.id) || ({ ...order, status: parsed.status! } as Order);
    return orderCard(fresh);
  }
  return { reply: `Heard status "${parsed.status}". Which order? Send the order number.`, awaiting: `setstatus:${parsed.status}` };
};

const handleVoice = async (role: string | null, lang: Lang, mediaUrl: string, awaiting: string | undefined): Promise<Reply> => {
  const transcript = await transcribeUrl(mediaUrl);
  if (!transcript) return buildMenu(role, lang, L(lang, 'voiceFail'));
  const prefix = `📝 "${transcript}"\n\n`;
  if (awaiting && awaiting !== 'spoken') {
    const r = await dispatch(role, undefined, transcript, awaiting, lang);
    return { ...r, reply: prefix + r.reply };
  }
  const r = await applySpokenUpdate(lang, transcript);
  return { ...r, reply: prefix + r.reply };
};

const handleImage = async (role: string | null, lang: Lang, mediaUrl: string, awaiting: string | undefined): Promise<Reply> => {
  const att: Attachment = { name: 'photo.jpg', url: mediaUrl, type: 'image' };
  if (awaiting && awaiting.startsWith('upload:file:')) {
    const styleNumber = awaiting.slice('upload:file:'.length);
    const ok = await attachFileToStyle(styleNumber, att);
    return {
      reply: ok ? `✅ Photo attached to style ${styleNumber}. Send more, or tap Menu.` : `Could not attach (style ${styleNumber} not found).`,
      awaiting: ok ? awaiting : null,
      buttons: [MENU_BTN],
    };
  }
  return { reply: L(lang, 'uploadAskStyle'), awaiting: `upload:pending:${encodeURIComponent(mediaUrl)}` };
};

// ---------- Main dispatcher ----------
const dispatch = async (role: string | null, action: string | undefined, text: string | undefined, awaiting: string | undefined, lang: Lang): Promise<Reply> => {
  // A typed message while we're waiting for an input.
  if (!action && awaiting) {
    const input = (text || '').trim();
    if (awaiting === 'order') return runOrderStatus(input);
    if (awaiting === 'style:summary') return runStyleSummary(input);
    if (awaiting === 'style:files' || awaiting === 'style:measure') return runStyleFiles(input);
    if (awaiting === 'stock:style') return runStockLookup(input);
    if (awaiting === 'matorder') return runOrderMaterials(input);
    if (awaiting === 'spoken') return applySpokenUpdate(lang, input);
    if (awaiting === 'ai') return runAi(lang, input);
    if (awaiting === 'req:style') {
      const style = await fetchStyleByNumber(input.split(' - ')[0].trim());
      if (!style) return { reply: `Style "${input}" not found. Send the style number again.`, awaiting };
      return {
        reply: `Style ${style.style_number}. Send a per-piece requirement, e.g. "Main fabric 1.2 meter", "Buttons 6 per piece", "1 cone for 50 pieces", or "Lining 1.1 meter only for Red". Tap Menu when done.`,
        awaiting: `req:line:${encodeURIComponent(style.style_number)}`,
        buttons: [MENU_BTN],
      };
    }
    if (awaiting.startsWith('req:line:')) {
      const styleNumber = decodeURIComponent(awaiting.slice('req:line:'.length));
      return runRequirementLine(styleNumber, input);
    }
    if (awaiting === 'newmat:order') {
      if (/^(skip|none|no|general|-)$/i.test(input)) {
        return { reply: 'General request. What material do you need? (e.g. "Black sewing thread")', awaiting: 'newmat:name::' };
      }
      const order = findOrder(await fetchOrders(), input);
      if (!order) return { reply: `Order "${input}" not found. Send a valid order number, or "skip".`, awaiting };
      return {
        reply: `Order ${formatOrderNumber(order)} (${(order.style_number || '').split(' - ')[0]}). What material do you need?`,
        awaiting: `newmat:name:${order.id}:${encodeURIComponent(order.style_number || '')}`,
      };
    }
    if (awaiting.startsWith('newmat:name:')) {
      const [, , orderId = '', styleEnc = ''] = awaiting.split(':');
      const name = input.trim();
      if (!name) return { reply: 'Please send the material name.', awaiting };
      return { reply: `How much "${name}" is needed? Send a number (the quantity).`, awaiting: `newmat:qty:${orderId}:${styleEnc}:${encodeURIComponent(name)}` };
    }
    if (awaiting.startsWith('newmat:qty:')) {
      const [, , orderId = '', styleEnc = '', nameEnc = ''] = awaiting.split(':');
      return runNewMaterial(orderId, decodeURIComponent(styleEnc), decodeURIComponent(nameEnc), input);
    }
    if (awaiting === 'commit:order') return runCommitPreview(input);
    if (awaiting.startsWith('note:')) {
      const note = decodeURIComponent(awaiting.slice('note:'.length));
      const order = findOrder(await fetchOrders(), input);
      if (!order) return { reply: `Order "${input}" not found. Send the order number again.`, awaiting };
      await addOrderLog(order.id, 'MANUAL_UPDATE', note, 'Tintura Chat');
      return { reply: `📝 Added to ${formatOrderNumber(order)}'s timeline.`, buttons: [{ label: '📦 Open order', action: `ocard:${order.id}` }, MENU_BTN] };
    }
    if (awaiting.startsWith('setstatus:')) {
      const status = awaiting.slice('setstatus:'.length) as OrderStatus;
      const order = findOrder(await fetchOrders(), input);
      if (!order) return { reply: `Order "${input}" not found. Send the order number again.`, awaiting };
      try { await updateOrderStatus(order.id, status); } catch (e: any) { return { reply: `Could not update: ${e?.message || 'error'}.`, buttons: [MENU_BTN] }; }
      const fresh = (await fetchOrders()).find((o) => o.id === order.id) || ({ ...order, status } as Order);
      return orderCard(fresh);
    }
    if (awaiting.startsWith('inv:')) {
      const [, procId, qtyStr] = awaiting.split(':');
      try { await advanceProcurement(procId, Number(qtyStr) || 0, MaterialStage.ORDERED, { invoice_no: input, created_by_name: 'Tintura Chat' }); }
      catch (e: any) { return { reply: `Could not update: ${e?.message || 'error'}.`, buttons: [MENU_BTN] }; }
      return { reply: `✅ Marked as Ordered (invoice ${input}).`, buttons: [MENU_BTN] };
    }
    if (awaiting === 'upload:style') {
      const style = await fetchStyleByNumber(input.split(' - ')[0].trim());
      if (!style) return { reply: `Style "${input}" not found. Send the style number again.`, awaiting };
      return { reply: `${L(lang, 'uploadSendNow')} (${style.style_number})`, awaiting: `upload:file:${style.style_number}` };
    }
    if (awaiting.startsWith('upload:pending:')) {
      const url = decodeURIComponent(awaiting.slice('upload:pending:'.length));
      const style = await fetchStyleByNumber(input.split(' - ')[0].trim());
      if (!style) return { reply: `Style "${input}" not found. Send the style number again.`, awaiting };
      const ok = await attachFileToStyle(style.style_number, { name: 'photo.jpg', url, type: 'image' });
      return { reply: ok ? `✅ Photo attached to style ${style.style_number}. Send more photos, or tap Menu.` : 'Could not attach the photo.', awaiting: ok ? `upload:file:${style.style_number}` : null, buttons: [MENU_BTN] };
    }
  }

  // A typed message with no pending input → greeting / menu.
  if (!action) {
    const t = (text || '').trim().toLowerCase();
    if (/^(\/)?(hi|hello|hey|hai|menu|start|help|hola|namaste|vanakkam)\b/.test(t) || !t) {
      return buildMenu(role, lang, L(lang, 'menuIntro'));
    }
    return buildMenu(role, lang, L(lang, 'tapOption'));
  }

  // Role gate for top-level actions.
  if (action.startsWith('act:')) {
    if (!allowedBotActions(role).includes(action)) {
      return buildMenu(role, lang, L(lang, 'noAccess'));
    }
  }

  if (action === 'menu') return buildMenu(role, lang);
  if (action === 'act:orders') return runActiveOrders();
  if (action === 'act:daily') return runDailySummary();
  if (action === 'act:order') return { reply: L(lang, 'askOrder'), awaiting: 'order' };
  if (action === 'act:summary') return { reply: L(lang, 'askSummary'), awaiting: 'style:summary' };
  if (action === 'act:files') return { reply: L(lang, 'askFiles'), awaiting: 'style:files' };
  if (action === 'act:measure') return { reply: L(lang, 'askMeasure'), awaiting: 'style:measure' };
  if (action === 'act:stock') return { reply: L(lang, 'askStock'), awaiting: 'stock:style' };
  if (action === 'act:matorder') return { reply: L(lang, 'askMatOrder'), awaiting: 'matorder' };
  if (action === 'act:newpo') return runPoForm(lang);
  if (action === 'act:upload') return { reply: 'Send the style number you want to add files to.', awaiting: 'upload:style' };
  if (action === 'act:voice') return { reply: '🎙️ Tap the mic and speak, or type an update — e.g. "Order 1004 stitching done" / "1004 black thread received".', awaiting: 'spoken' };
  if (action === 'act:reqadd') return { reply: 'Send the style number to add a per-piece quantity / requirement to.', awaiting: 'req:style', buttons: [MENU_BTN] };
  if (action === 'act:newmat') return { reply: '🆕 New material request.\nSend the order number this material is for, or type "skip" for a general (no-order) request.', awaiting: 'newmat:order', buttons: [MENU_BTN] };
  if (action === 'act:popdf') return runPoPdfList();
  if (action === 'act:completionpdf') return runCompletionPdfList();
  if (action === 'act:commit') return { reply: '📥 Send the order number whose completed pieces you want to push into inventory.', awaiting: 'commit:order', buttons: [MENU_BTN] };
  if (action === 'act:ai') return { reply: '🤖 Ask me anything about your orders, materials, stock or sales.', awaiting: 'ai', buttons: [MENU_BTN] };

  if (action.startsWith('ocard:')) return orderCardById(action.slice('ocard:'.length));
  if (action.startsWith('popdf:')) return runPoPdf(action.slice('popdf:'.length));
  if (action.startsWith('completionpdf:')) return runCompletionPdf(action.slice('completionpdf:'.length));
  if (action.startsWith('commitgo:')) return runCommitGo(action.slice('commitgo:'.length));
  if (action.startsWith('adv:')) return advanceOrder(action.slice('adv:'.length));
  if (action.startsWith('osum:')) {
    const style = await styleForOrder(action.slice('osum:'.length));
    return style ? styleSummary(style) : { reply: 'Style not found for that order.', buttons: [MENU_BTN] };
  }
  if (action.startsWith('ofiles:')) {
    const style = await styleForOrder(action.slice('ofiles:'.length));
    return style ? runStyleFiles(style.style_number) : { reply: 'Style not found for that order.', buttons: [MENU_BTN] };
  }
  if (action.startsWith('omat:')) {
    const order = (await fetchOrders()).find((o) => o.id === action.slice('omat:'.length));
    return order ? runOrderMaterials(order.order_no || formatOrderNumber(order)) : { reply: 'That order no longer exists.', buttons: [MENU_BTN] };
  }

  return buildMenu(role, lang);
};

const orderCardById = async (id: string): Promise<Reply> => {
  const order = (await fetchOrders()).find((o) => o.id === id);
  if (!order) return { reply: 'That order no longer exists.', buttons: [MENU_BTN] };
  return orderCard(order);
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { role = null, action, text, awaiting, kind, mediaUrl, po, createdBy } = body;
    const lang: Lang = body.lang === 'ta' || body.lang === 'tang' ? body.lang : 'en';

    let out: Reply;
    if (action === 'act:po:submit') out = await submitPo(lang, po, createdBy);
    else if (kind === 'voice' && mediaUrl) out = await handleVoice(role, lang, mediaUrl, awaiting);
    else if (kind === 'image' && mediaUrl) out = await handleImage(role, lang, mediaUrl, awaiting);
    else out = await dispatch(role, action, text, awaiting, lang);

    return res.status(200).json(out);
  } catch (e: any) {
    return res.status(200).json({ reply: `Something went wrong: ${e?.message || 'unknown error'}.`, buttons: [MENU_BTN] });
  }
}
