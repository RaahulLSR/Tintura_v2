// =====================================================================
// Order Completion Report — serves a finished order's summary PDF inline so
// it can be opened from the Tintura SST inbox card or an email link.
// Usage: GET /api/completion-report?id=<orderId>
// =====================================================================
import { fetchOrders, fetchOrderLogs, fetchProcurements, fetchUnits } from '../services/db.js';
import { buildCompletionReportBytes } from '../services/completionReport.js';
import { formatOrderNumber } from '../types.js';

export default async function handler(req: any, res: any) {
  const id = String((req.query?.id ?? '') || '').trim();
  if (!id) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send('<p style="font-family:sans-serif;padding:24px">Missing ?id= parameter.</p>');
  }
  try {
    const [orders, logs, procurements, units] = await Promise.all([
      fetchOrders().catch(() => []),
      fetchOrderLogs(id).catch(() => []),
      fetchProcurements().catch(() => []),
      fetchUnits().catch(() => []),
    ]);
    const order = orders.find((o) => String(o.id) === id);
    if (!order) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send('<p style="font-family:sans-serif;padding:24px">Order not found.</p>');
    }
    const unitName = units.find((u) => u.id === order.unit_id)?.name || '';
    const bytes = await buildCompletionReportBytes(order, logs, procurements, { unitName });
    const safe = formatOrderNumber(order).replace(/[^A-Za-z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="completion-${safe}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(bytes));
  } catch (e: any) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`<p style="font-family:sans-serif;padding:24px">Error: ${String(e?.message || 'unknown')}</p>`);
  }
}
