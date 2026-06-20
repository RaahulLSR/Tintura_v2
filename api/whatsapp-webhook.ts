import { createClient } from '@supabase/supabase-js';
import { newConversation, sendUserMessage, approvePending } from '../services/geminiService.js';
import { loadSettings } from '../services/appSettings.js';
import { UserRole } from '../types.js';

/**
 * WhatsApp Webhook (Meta Cloud API)
 * ---------------------------------
 * Lets the MD / accessories manager talk to the SAME AI brain (tool registry +
 * agent) from WhatsApp — including Tamil / Tanglish voice notes, which are
 * transcribed with Groq Whisper before being handed to the agent.
 *
 * Setup (Meta WhatsApp Cloud API):
 *  1. Create a Meta app + WhatsApp product, get a phone number id + permanent token.
 *  2. Set the webhook callback URL to https://<your-app>/api/whatsapp-webhook and
 *     the verify token to WHATSAPP_VERIFY_TOKEN. Subscribe to "messages".
 *
 * Required env vars (Vercel project settings):
 *   WHATSAPP_TOKEN              - Meta permanent access token
 *   WHATSAPP_PHONE_NUMBER_ID    - the sending phone number id
 *   WHATSAPP_VERIFY_TOKEN       - any random string, used for GET verification
 *   GROQ_API_KEY (or VITE_*)    - AI provider key (also used for Whisper voice)
 *   VITE_AI_PROVIDER=groq
 *   VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or anon)
 * Optional:
 *   WHATSAPP_ALLOWED_NUMBERS    - comma-separated wa_id allow-list
 *   WHATSAPP_AUTO_APPROVE=true  - auto-run high-risk actions (command mode)
 *   GROQ_WHISPER_MODEL          - default whisper-large-v3
 */

const GRAPH = 'https://graph.facebook.com/v20.0';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

const GROQ_KEY =
  process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY || process.env.GROQ_KEY;

const sendWhatsApp = async (phoneNumberId: string, token: string, to: string, text: string) => {
  await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });
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

/** Download a WhatsApp media file and transcribe it with Groq Whisper. */
const transcribeVoice = async (mediaId: string, token: string): Promise<string | null> => {
  if (!GROQ_KEY) return null;
  try {
    // 1. Resolve the media URL.
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
    const meta = await metaRes.json();
    if (!meta?.url) return null;
    // 2. Download the audio bytes (needs the Meta token).
    const audioRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await audioRes.arrayBuffer());
    // 3. Send to Groq Whisper (multilingual, handles Tamil/Tanglish).
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: meta.mime_type || 'audio/ogg' }), 'voice.ogg');
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

export default async function handler(req: any, res: any) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  // ---- GET: webhook verification handshake ----
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const verify = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && verify === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ ok: false });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!token || !phoneNumberId) return res.status(500).json({ ok: false, error: 'WhatsApp env vars missing' });

  // Parse the first message from the Cloud API payload.
  const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
  const message = entry?.messages?.[0];
  if (!message) return res.status(200).json({ ok: true }); // status callbacks etc.

  const from = message.from; // wa_id of the sender

  // Optional allow-list.
  const allowed = (process.env.WHATSAPP_ALLOWED_NUMBERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(String(from))) {
    await sendWhatsApp(phoneNumberId, token, from, 'You are not authorised to use this assistant.');
    return res.status(200).json({ ok: true });
  }

  // Gate behind the whatsapp_bot feature toggle.
  if (!(await featureEnabled('whatsapp_bot'))) {
    await sendWhatsApp(phoneNumberId, token, from, 'The WhatsApp assistant is currently turned off.');
    return res.status(200).json({ ok: true });
  }

  // Resolve the user's text — from a text message or a transcribed voice note.
  let text: string | null = null;
  if (message.type === 'text') {
    text = message.text?.body || null;
  } else if (message.type === 'audio' || message.type === 'voice') {
    const mediaId = message.audio?.id || message.voice?.id;
    if (mediaId) text = await transcribeVoice(mediaId, token);
    if (!text) {
      await sendWhatsApp(phoneNumberId, token, from, "Sorry, I couldn't understand that voice note. Please try again or type it.");
      return res.status(200).json({ ok: true });
    }
  }
  if (!text) return res.status(200).json({ ok: true });

  const ctx = {
    actor: `wa:${from}`,
    role: UserRole.TECH_MANAGER,
    source: 'human' as const,
  };

  try {
    await loadSettings();
    let resp = await sendUserMessage(newConversation(), text, ctx);

    if (resp.pendingApproval) {
      if (process.env.WHATSAPP_AUTO_APPROVE === 'true') {
        resp = await approvePending(resp.state, ctx);
      } else {
        await sendWhatsApp(
          phoneNumberId,
          token,
          from,
          `Drafted action: ${resp.pendingApproval.summary}\n` +
            `This is a high-risk action — approve it in the Tintura app, ` +
            `or enable command mode (WHATSAPP_AUTO_APPROVE) to run it directly.`
        );
        return res.status(200).json({ ok: true });
      }
    }

    await sendWhatsApp(phoneNumberId, token, from, resp.error ? `Error: ${resp.error}` : resp.text || 'Done.');
  } catch (e: any) {
    await sendWhatsApp(phoneNumberId, token, from, `Error: ${e.message}`);
  }

  return res.status(200).json({ ok: true });
}
