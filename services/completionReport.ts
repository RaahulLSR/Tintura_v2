// =====================================================================
// Order Completion Report PDF (isomorphic: browser + Node via pdf-lib).
// A complete summary of a finished production order: the breakdown table
// that was filled in before committing stock, total pieces, issue/complete
// dates, the action timeline, and the materials consumed for the order.
// Powers the "Tintura SST" document delivery + the in-app / email reports.
// =====================================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Order, OrderLog, MaterialProcurement, SizeBreakdown } from '../types.js';
import { formatOrderNumber, getSizeKeyFromLabel } from '../types.js';
import { STICKER_URL } from './brandAssets.js';

const sumBreakdown = (rows: SizeBreakdown[] | undefined, keys: string[]): number =>
  (rows || []).reduce((tot, r) => tot + keys.reduce((a, k) => a + (Number(r[k]) || 0), 0), 0);

/** Build a one-page (auto-paginating) order completion report PDF. */
export const buildCompletionReportBytes = async (
  order: Order,
  logs: OrderLog[],
  procurements: MaterialProcurement[],
  opts: { unitName?: string } = {}
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const PW = 595.28;
  const PH = 841.89;
  const margin = 40;
  const usable = PW - margin * 2;

  const dark = rgb(0.13, 0.16, 0.22);
  const grey = rgb(0.45, 0.5, 0.55);
  const lineCol = rgb(0.85, 0.87, 0.9);
  const ink = rgb(0.043, 0.043, 0.047);
  const amber = rgb(0.961, 0.651, 0.137);
  const white = rgb(1, 1, 1);
  const headerBg = rgb(0.96, 0.97, 0.99);
  const zebra = rgb(0.975, 0.98, 0.99);
  const green = rgb(0.06, 0.5, 0.32);

  let page: PDFPage = pdf.addPage([PW, PH]);
  let y = PH;

  const safe = (s: string): string =>
    (s ?? '')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-')
      .replace(/[\u2192\u27A1]/g, '->')
      .replace(/\u20B9/g, 'Rs')
      .replace(/[\u2022\u00B7]/g, '\u00B7')
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');

  const draw = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = dark) =>
    page.drawText(safe(s), { x, y: yy, size, font: f, color });

  const drawAligned = (
    s: string, boxX: number, boxW: number, yy: number,
    align: 'l' | 'c' | 'r', size = 9, f: PDFFont = font, color = dark
  ) => {
    const tw = f.widthOfTextAtSize(safe(s), size);
    let x = boxX + 4;
    if (align === 'r') x = boxX + boxW - tw - 4;
    else if (align === 'c') x = boxX + (boxW - tw) / 2;
    draw(s, x, yy, size, f, color);
  };

  const ensureSpace = (needed: number) => {
    if (y < margin + needed) {
      page = pdf.addPage([PW, PH]);
      y = PH - margin;
    }
  };

  // ---- Header band ----
  page.drawRectangle({ x: 0, y: PH - 92, width: PW, height: 92, color: headerBg });
  let titleX = margin;
  try {
    const res = await fetch(STICKER_URL);
    if (res.ok) {
      const img = await pdf.embedPng(new Uint8Array(await res.arrayBuffer()));
      const s = 46;
      page.drawImage(img, { x: margin, y: PH - 14 - s, width: s, height: s });
      titleX = margin + s + 12;
    }
  } catch { /* sticker optional */ }
  draw('ORDER COMPLETION REPORT', titleX, PH - 52, 18, bold, dark);

  // TINTURA badge (top-right).
  const logoText = 'TINTURA';
  const logoSize = 13;
  const logoTextW = bold.widthOfTextAtSize(logoText, logoSize);
  const dotR = 2;
  const padX = 11;
  const gap = 7;
  const boxW = padX * 2 + dotR * 4 + gap * 2 + logoTextW;
  const boxH = 28;
  const boxX = PW - margin - boxW;
  const cy = PH - 44;
  page.drawRectangle({ x: boxX, y: cy - boxH / 2, width: boxW, height: boxH, color: ink });
  page.drawCircle({ x: boxX + padX + dotR, y: cy, size: dotR, color: amber });
  draw(logoText, boxX + padX + dotR * 2 + gap, cy - logoSize / 2 + 1, logoSize, bold, white);
  page.drawCircle({ x: boxX + boxW - padX - dotR, y: cy, size: dotR, color: amber });
  const sub = 'Production -> Inventory';
  draw(sub, PW - margin - font.widthOfTextAtSize(sub, 8), PH - 72, 8, font, grey);
  y = PH - 116;

  // ---- Completion / issue dates ----
  const ascLogs = [...(logs || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const completedLog = [...ascLogs].reverse().find(
    (l) => l.log_type === 'STATUS_CHANGE' && /COMPLETED/i.test(l.message || '')
  );
  const issuedAt = order.created_at || ascLogs[0]?.created_at || '';
  const completedAt = completedLog?.created_at || ascLogs[ascLogs.length - 1]?.created_at || '';
  const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString() : '—');

  // ---- Meta block (two columns) ----
  const metaPair = (label: string, val: string, col: 0 | 1) => {
    const x = margin + col * (usable / 2);
    draw(label.toUpperCase(), x, y, 8, bold, grey);
    draw(val || '—', x + 96, y, 10, font, dark);
  };
  metaPair('Order No', formatOrderNumber(order), 0);
  metaPair('Status', String(order.status), 1);
  y -= 16;
  metaPair('Style', order.style_number || '—', 0);
  metaPair('Unit', opts.unitName || '—', 1);
  y -= 16;
  metaPair('Issued', fmt(issuedAt), 0);
  metaPair('Completed', fmt(completedAt), 1);
  y -= 16;
  metaPair('Target Date', order.target_delivery_date || '—', 0);
  metaPair('Boxes', String(order.actual_box_count ?? order.box_count ?? '—'), 1);
  y -= 26;

  // ---- Summary chips (Ordered / Completed) ----
  const format: 'standard' | 'numeric' = order.size_format === 'numeric' ? 'numeric' : 'standard';
  const allKeys = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'];
  const orderedQty = order.quantity || sumBreakdown(order.size_breakdown, allKeys);
  const completedQty = sumBreakdown(order.completion_breakdown, allKeys);

  const chip = (label: string, val: string, x: number, w: number, accent = dark) => {
    page.drawRectangle({ x, y: y - 40, width: w, height: 40, color: headerBg, borderColor: lineCol, borderWidth: 1 });
    draw(label.toUpperCase(), x + 10, y - 14, 8, bold, grey);
    draw(val, x + 10, y - 33, 16, bold, accent);
  };
  const chipW = (usable - 16) / 2;
  chip('Ordered pieces', String(orderedQty), margin, chipW, dark);
  chip('Completed pieces', String(completedQty), margin + chipW + 16, chipW, green);
  y -= 56;

  // ---- Generic size-matrix table renderer ----
  const sizeLabels = (order.size_sequence && order.size_sequence.length
    ? order.size_sequence
    : (format === 'numeric' ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL']));

  const renderMatrix = (heading: string, rows: SizeBreakdown[] | undefined) => {
    const data = rows || [];
    // keep only size columns that have any quantity
    const cols = sizeLabels
      .map((label) => ({ label, key: getSizeKeyFromLabel(label, format) }))
      .filter((c) => data.some((r) => Number(r[c.key]) > 0));
    ensureSpace(60 + (data.length + 2) * 18);
    draw(heading, margin, y, 11, bold, dark);
    y -= 16;

    if (data.length === 0) {
      draw('No breakdown recorded.', margin, y, 9, font, grey);
      y -= 22;
      return;
    }
    const colColour = 110;
    const colTotal = 50;
    const colSize = cols.length ? Math.max(34, (usable - colColour - colTotal) / cols.length) : 0;
    const xColour = margin;
    const xSizes = margin + colColour;
    const xTotal = margin + usable - colTotal;
    const rowH = 18;

    // header
    page.drawRectangle({ x: margin, y: y - rowH + 4, width: usable, height: rowH, color: dark });
    drawAligned('Colour', xColour, colColour, y - 9, 'l', 8, bold, white);
    cols.forEach((c, i) => drawAligned(c.label, xSizes + i * colSize, colSize, y - 9, 'c', 8, bold, white));
    drawAligned('Total', xTotal, colTotal, y - 9, 'r', 8, bold, white);
    y -= rowH;

    data.forEach((r, idx) => {
      if (idx % 2 === 1) page.drawRectangle({ x: margin, y: y - rowH + 4, width: usable, height: rowH, color: zebra });
      drawAligned(String(r.color || 'All'), xColour, colColour, y - 9, 'l', 8, bold, dark);
      let rowTot = 0;
      cols.forEach((c, i) => {
        const v = Number(r[c.key]) || 0;
        rowTot += v;
        drawAligned(v ? String(v) : '', xSizes + i * colSize, colSize, y - 9, 'c', 8, font, dark);
      });
      drawAligned(String(rowTot), xTotal, colTotal, y - 9, 'r', 8, bold, dark);
      page.drawLine({ start: { x: margin, y: y - rowH + 4 }, end: { x: margin + usable, y: y - rowH + 4 }, thickness: 0.5, color: lineCol });
      y -= rowH;
    });

    // totals row
    page.drawRectangle({ x: margin, y: y - rowH + 4, width: usable, height: rowH, color: headerBg });
    drawAligned('TOTAL', xColour, colColour, y - 9, 'l', 8, bold, dark);
    cols.forEach((c, i) => {
      const sum = data.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
      drawAligned(sum ? String(sum) : '', xSizes + i * colSize, colSize, y - 9, 'c', 8, bold, dark);
    });
    const grand = data.reduce((a, r) => a + cols.reduce((s, c) => s + (Number(r[c.key]) || 0), 0), 0);
    drawAligned(String(grand), xTotal, colTotal, y - 9, 'r', 8, bold, green);
    y -= rowH + 22;
  };

  renderMatrix('Completed production (entered before commit)', order.completion_breakdown);
  if ((order.size_breakdown || []).length) renderMatrix('Original order breakdown', order.size_breakdown);

  // ---- Materials consumed ----
  const mats = (procurements || []).filter((p) => p.order_id && String(p.order_id) === String(order.id));
  ensureSpace(60 + (mats.length + 2) * 18);
  draw('Materials consumed for this order', margin, y, 11, bold, dark);
  y -= 16;
  if (mats.length === 0) {
    draw('No materials were linked to this order.', margin, y, 9, font, grey);
    y -= 22;
  } else {
    const mCols = [
      { key: 'name', label: 'Material', w: 168, align: 'l' as const },
      { key: 'unit', label: 'Unit', w: 50, align: 'l' as const },
      { key: 'req', label: 'Requested', w: 60, align: 'r' as const },
      { key: 'ord', label: 'Ordered', w: 55, align: 'r' as const },
      { key: 'rec', label: 'Received', w: 60, align: 'r' as const },
      { key: 'rel', label: 'Released', w: 60, align: 'r' as const },
    ];
    const xOf = (i: number) => margin + mCols.slice(0, i).reduce((a, c) => a + c.w, 0);
    const rowH = 18;
    page.drawRectangle({ x: margin, y: y - rowH + 4, width: usable, height: rowH, color: dark });
    mCols.forEach((c, i) => drawAligned(c.label, xOf(i), c.w, y - 9, c.align, 8, bold, white));
    y -= rowH;
    mats.forEach((m, idx) => {
      ensureSpace(rowH * 2);
      if (idx % 2 === 1) page.drawRectangle({ x: margin, y: y - rowH + 4, width: usable, height: rowH, color: zebra });
      const cell = (k: string) => {
        switch (k) {
          case 'name': return m.material_name || '';
          case 'unit': return m.unit || '';
          case 'req': return String(m.qty_requested ?? 0);
          case 'ord': return String(m.qty_ordered ?? 0);
          case 'rec': return String(m.qty_received ?? 0);
          case 'rel': return String(m.qty_released ?? 0);
          default: return '';
        }
      };
      mCols.forEach((c, i) => drawAligned(cell(c.key), xOf(i), c.w, y - 9, c.align, 8, c.key === 'name' ? bold : font, dark));
      page.drawLine({ start: { x: margin, y: y - rowH + 4 }, end: { x: margin + usable, y: y - rowH + 4 }, thickness: 0.5, color: lineCol });
      y -= rowH;
    });
    y -= 22;
  }

  // ---- Action timeline ----
  ensureSpace(80);
  draw('Action timeline', margin, y, 11, bold, dark);
  y -= 16;
  if (ascLogs.length === 0) {
    draw('No timeline activity recorded.', margin, y, 9, font, grey);
    y -= 16;
  } else {
    ascLogs.forEach((l) => {
      const when = fmt(l.created_at);
      const who = l.created_by_name ? ` (${l.created_by_name})` : '';
      const msg = `${l.message || ''}${who}`;
      // wrap the message to the available width
      const maxW = usable - 130;
      const words = safe(msg).split(/\s+/);
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (font.widthOfTextAtSize(test, 8.5) > maxW && cur) { lines.push(cur); cur = w; }
        else cur = test;
      }
      if (cur) lines.push(cur);
      ensureSpace(lines.length * 12 + 6);
      page.drawCircle({ x: margin + 3, y: y - 3, size: 2, color: amber });
      draw(when, margin + 12, y - 6, 8, bold, grey);
      lines.forEach((ln, i) => draw(ln, margin + 130, y - 6 - i * 11, 8.5, font, dark));
      y -= Math.max(14, lines.length * 11 + 4);
    });
  }

  // ---- Footer on every page ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(safe(`Generated ${new Date().toLocaleString()} \u00B7 Tintura SST  \u00B7  Page ${i + 1}/${pages.length}`),
      { x: margin, y: margin - 6, size: 7.5, font, color: grey });
  });

  return await pdf.save();
};
