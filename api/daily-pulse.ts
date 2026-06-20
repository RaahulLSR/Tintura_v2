import { createClient } from '@supabase/supabase-js';

/**
 * Daily Pulse
 * -----------
 * Automated 6:00 PM operations summary pushed to Telegram. Triggered by a Vercel
 * Cron (see vercel.json). Templated (no LLM call) so it is fast and reliable.
 *
 * Required env:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_PULSE_CHAT_ID   (or first id in TELEGRAM_ALLOWED_CHAT_IDS)
 *   VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or anon)
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

const sendTelegram = async (token: string, chatId: string, text: string) => {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
};

export default async function handler(_req: any, res: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId =
    process.env.TELEGRAM_PULSE_CHAT_ID ||
    (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',')[0]?.trim();

  if (!token || !chatId) return res.status(500).json({ ok: false, error: 'Telegram config missing' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ ok: false, error: 'Supabase config missing' });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Active orders (respecting the soft-delete convention).
    const { data: orders } = await supabase
      .from('orders')
      .select('order_no, status, target_delivery_date, quantity, deleted')
      .or('deleted.eq.false,deleted.is.null');

    const list = orders || [];
    const byStatus: Record<string, number> = {};
    let overdue = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const o of list) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      if (o.target_delivery_date && o.target_delivery_date < today && o.status !== 'COMPLETED') overdue++;
    }

    // Pending material requests.
    const { data: reqs } = await supabase
      .from('material_requests')
      .select('status')
      .in('status', ['PENDING', 'PARTIALLY_APPROVED']);

    const statusLines =
      Object.entries(byStatus)
        .map(([s, n]) => `  • ${s}: <b>${n}</b>`)
        .join('\n') || '  • (no active orders)';

    const message =
      `<b>🧵 Tintura Daily Pulse</b>\n` +
      `${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}\n\n` +
      `<b>Active orders:</b> ${list.length}\n` +
      `${statusLines}\n\n` +
      `<b>Overdue:</b> ${overdue}\n` +
      `<b>Pending material requests:</b> ${reqs?.length || 0}`;

    await sendTelegram(token, chatId, message);
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
