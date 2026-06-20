// =====================================================================
// TINTURA PO PDF — serves a sales order's PDF inline so the bot can hand
// out a single openable link. Usage: GET /api/po-pdf?id=<salesOrderId>
// =====================================================================
import { fetchSalesOrders } from '../services/db.js';
import { buildPoPdfBytes } from '../services/poPdf.js';
import type { SalesOrder } from '../types.js';

export default async function handler(req: any, res: any) {
  const id = String((req.query?.id ?? '') || '').trim();
  if (!id) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send('<p style="font-family:sans-serif;padding:24px">Missing ?id= parameter.</p>');
  }
  try {
    const pos = await fetchSalesOrders().catch(() => [] as SalesOrder[]);
    const po = pos.find((p) => String(p.id) === id);
    if (!po) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send('<p style="font-family:sans-serif;padding:24px">PO not found.</p>');
    }
    const bytes = await buildPoPdfBytes(po);
    const safe = (po.po_number || 'PO').replace(/[^A-Za-z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safe}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(bytes));
  } catch (e: any) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`<p style="font-family:sans-serif;padding:24px">Error: ${String(e?.message || 'unknown')}</p>`);
  }
}
