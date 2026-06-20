// =====================================================================
// Telegram fan-out notifier. POST { targetRole?, chatIds?, text?, documentUrl?, caption? }
// and the message (or document) is delivered to every linked Telegram chat of
// that role (and/or the explicit chat ids). Used by the web app for events that
// must also reach Telegram — e.g. a PO being forwarded to Accounts (the PO PDF
// is sent as a real document attachment), or a stock line hitting zero (admin
// alert). Runs on the ERP deployment which holds TELEGRAM_BOT_TOKEN.
// =====================================================================
import { fetchAppUsers } from '../services/db.js';

const sendTelegram = async (token: string, chatId: string, text: string) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  return r.ok;
};

const sendTelegramDocument = async (token: string, chatId: string, url: string, caption?: string) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, document: url, caption: caption?.slice(0, 1000), parse_mode: 'HTML' }),
  });
  return r.ok;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN missing' });

  let body: any = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
  const targetRole: string | undefined = body?.targetRole;
  const chatIds: any[] = Array.isArray(body?.chatIds) ? body.chatIds : [];
  const text: string = String(body?.text || '').trim();
  const documentUrl: string = String(body?.documentUrl || '').trim();
  const caption: string = String(body?.caption || '').trim();
  if (!text && !documentUrl) return res.status(400).json({ ok: false, error: 'text or documentUrl required' });

  const ids = new Set<string>();
  chatIds.forEach((c) => { if (c) ids.add(String(c)); });
  if (targetRole) {
    const users = await fetchAppUsers().catch(() => [] as any[]);
    users
      .filter((u: any) => u.role === targetRole && u.telegram_chat_id)
      .forEach((u: any) => ids.add(String(u.telegram_chat_id)));
  }

  let sent = 0;
  for (const id of ids) {
    try {
      if (documentUrl) {
        // Deliver the PO PDF (or any file) as a real document attachment.
        if (await sendTelegramDocument(token, id, documentUrl, caption || text)) sent++;
      } else if (text) {
        if (await sendTelegram(token, id, text)) sent++;
      }
    } catch { /* best-effort */ }
  }
  return res.status(200).json({ ok: true, sent, targeted: ids.size });
}
