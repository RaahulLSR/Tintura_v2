// =====================================================================
// Order summary generation endpoint. This keeps the completion flow server-
// side and avoids browser-only issues when the AI summary is triggered from
// the app after an order is completed.
// =====================================================================
import { generateOrderIssueSummary } from '../services/issueSummary.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const orderId = String(body.orderId || '').trim();
  if (!orderId) return res.status(400).json({ ok: false, error: 'orderId is required' });

  try {
    const result = await generateOrderIssueSummary(orderId);
    return res.status(200).json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || 'Failed to generate order summary' });
  }
}
