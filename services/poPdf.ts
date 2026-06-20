// =====================================================================
// Purchase Order PDF builder (isomorphic: works in the browser and Node).
// pdf-lib + text, plus an optional brand sticker fetched from /public (the
// fetch is wrapped in try/catch so PDF generation never fails). Powers both
// the in-app "Download PDF" button and the Telegram "Send PO PDF" feature.
// =====================================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { SalesOrder } from '../types.js';
import { combinedSizeLabel } from './sizes.js';
import { STICKER_URL } from './brandAssets.js';

interface Col {
  key: string;        // 'style' | 'colour' | 'sz:<label>' | 'rate' | 'qty' | 'amount'
  label: string;
  w: number;
  align: 'l' | 'c' | 'r';
}

/** Build a clean one-page (auto-paginating) Purchase Order PDF. */
export const buildPoPdfBytes = async (po: SalesOrder): Promise<Uint8Array> => {
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
  const ink = rgb(0.043, 0.043, 0.047); // near-black logo badge
  const amber = rgb(0.961, 0.651, 0.137);
  const white = rgb(1, 1, 1);
  const headerBg = rgb(0.96, 0.97, 0.99);
  const zebra = rgb(0.975, 0.98, 0.99);

  let page: PDFPage = pdf.addPage([PW, PH]);
  let y = PH;

  // Helvetica uses WinAnsi encoding and throws on unsupported glyphs (₹, →,
  // emoji, curly quotes, …). Map the common ones and drop anything else so
  // user-supplied text (buyer names, notes) can never break PDF generation.
  const safe = (s: string): string =>
    (s ?? '')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-')
      .replace(/[\u2192\u27A1]/g, '->')
      .replace(/\u20B9/g, 'Rs')
      .replace(/[\u2022\u00B7]/g, '\u00B7')
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');

  const draw = (
    s: string,
    x: number,
    yy: number,
    size = 9,
    f: PDFFont = font,
    color = dark
  ) => page.drawText(safe(s), { x, y: yy, size, font: f, color });

  // Right/centre aligned text within a column box.
  const drawAligned = (
    s: string,
    boxX: number,
    boxW: number,
    yy: number,
    align: 'l' | 'c' | 'r',
    size = 9,
    f: PDFFont = font,
    color = dark
  ) => {
    const tw = f.widthOfTextAtSize(safe(s), size);
    let x = boxX + 4;
    if (align === 'r') x = boxX + boxW - tw - 4;
    else if (align === 'c') x = boxX + (boxW - tw) / 2;
    draw(s, x, yy, size, f, color);
  };

  // ---- Header band ----
  page.drawRectangle({ x: 0, y: PH - 92, width: PW, height: 92, color: headerBg });

  // Sticker (top-left): the round "Feel the cool" brand mark. Embedded if
  // reachable; silently skipped otherwise so PDF generation never fails.
  let titleX = margin;
  try {
    const res = await fetch(STICKER_URL);
    if (res.ok) {
      const img = await pdf.embedPng(new Uint8Array(await res.arrayBuffer()));
      const s = 46;
      page.drawImage(img, { x: margin, y: PH - 14 - s, width: s, height: s });
      titleX = margin + s + 12;
    }
  } catch {
    /* sticker unavailable — non-fatal */
  }
  draw('PURCHASE ORDER', titleX, PH - 52, 22, bold, dark);

  // TINTURA logo lockup (top-right): near-black badge, white wordmark, amber dots.
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
  const sub = 'Sales -> Accounts & Inventory';
  draw(sub, PW - margin - font.widthOfTextAtSize(sub, 8), PH - 72, 8, font, grey);
  y = PH - 116;

  // ---- Meta block ----
  const meta = (label: string, val: string) => {
    draw(label.toUpperCase(), margin, y, 8, bold, grey);
    draw(val || '—', margin + 92, y, 10, font, dark);
    y -= 16;
  };
  meta('PO Number', po.po_number);
  meta('Date', new Date(po.created_at || Date.now()).toLocaleString());
  meta('Buyer', po.buyer_name);
  meta('Status', po.status);
  if (po.note) meta('Note', po.note);
  y -= 10;

  // ---- Build columns ----
  const sizeLabels = po.size_labels && po.size_labels.length
    ? po.size_labels
    : Array.from(new Set((po.lines || []).flatMap((l) => Object.keys(l.sizes || {}))));
  const hasAmount = (po.total_amount || 0) > 0;

  // Header labels: POs store the exact display label chosen for each column
  // (number-only "65", letter-only "S" or combined "65/S"). Render verbatim;
  // only expand a bare token to the combined form when it is a known size and
  // not already an explicit single-form/custom label, to keep legacy POs (which
  // stored the full canonical letter set) looking like "65/S".
  const FULL_CANON = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
  const legacyHeaders =
    po.size_format !== 'numeric' &&
    sizeLabels.length === FULL_CANON.length &&
    sizeLabels.every((s, i) => s === FULL_CANON[i]);
  const headerLabel = (s: string) => (legacyHeaders ? combinedSizeLabel(s) : s);

  const colStyle = 96;
  const colColour = 58;
  const colQty = 32;
  const colRate = hasAmount ? 40 : 0;
  const colAmount = hasAmount ? 54 : 0;
  const sizeArea = Math.max(0, usable - colStyle - colColour - colQty - colRate - colAmount);
  const colSize = sizeLabels.length ? Math.min(46, sizeArea / sizeLabels.length) : 0;

  const cols: Col[] = [
    { key: 'style', label: 'Style', w: colStyle, align: 'l' },
    { key: 'colour', label: 'Colour', w: colColour, align: 'l' },
    ...sizeLabels.map((s) => ({ key: `sz:${s}`, label: headerLabel(s), w: colSize, align: 'c' as const })),
    ...(hasAmount ? [{ key: 'rate', label: 'Rate', w: colRate, align: 'r' as const }] : []),
    { key: 'qty', label: 'Qty', w: colQty, align: 'r' },
    ...(hasAmount ? [{ key: 'amount', label: 'Amount', w: colAmount, align: 'r' as const }] : []),
  ];

  const xOf = (idx: number) => margin + cols.slice(0, idx).reduce((a, c) => a + c.w, 0);

  const rowH = 18;
  const newPageIfNeeded = () => {
    if (y < margin + rowH * 2) {
      page = pdf.addPage([PW, PH]);
      y = PH - margin;
    }
  };

  const drawHeaderRow = () => {
    page.drawRectangle({ x: margin, y: y - rowH + 4, width: usable, height: rowH, color: dark });
    cols.forEach((c, i) => drawAligned(c.label, xOf(i), c.w, y - 9, c.align, 8, bold, rgb(1, 1, 1)));
    y -= rowH;
  };

  const cellValue = (key: string, line: SalesOrder['lines'][number]): string => {
    if (key === 'style') return line.style_number || '';
    if (key === 'colour') return line.color || 'All';
    if (key === 'qty') return String(line.total ?? 0);
    if (key === 'rate') return line.rate ? line.rate.toFixed(2) : '';
    if (key === 'amount') return line.amount ? line.amount.toFixed(2) : '';
    if (key.startsWith('sz:')) {
      const s = key.slice(3);
      return line.sizes?.[s] ? String(line.sizes[s]) : '';
    }
    return '';
  };

  drawHeaderRow();

  (po.lines || []).forEach((line, idx) => {
    newPageIfNeeded();
    if (idx % 2 === 1) page.drawRectangle({ x: margin, y: y - rowH + 4, width: usable, height: rowH, color: zebra });
    cols.forEach((c, i) => {
      const v = cellValue(c.key, line);
      const f = c.key === 'style' ? bold : font;
      drawAligned(v, xOf(i), c.w, y - 9, c.align, 8, f, c.key === 'colour' && !line.color ? grey : dark);
    });
    page.drawLine({ start: { x: margin, y: y - rowH + 4 }, end: { x: margin + usable, y: y - rowH + 4 }, thickness: 0.5, color: lineCol });
    y -= rowH;
  });

  // ---- Totals row ----
  newPageIfNeeded();
  page.drawRectangle({ x: margin, y: y - rowH + 4, width: usable, height: rowH, color: headerBg });
  drawAligned('TOTAL', xOf(0), cols[0].w, y - 9, 'l', 8, bold, dark);
  cols.forEach((c, i) => {
    if (c.key.startsWith('sz:')) {
      const s = c.key.slice(3);
      const sum = (po.lines || []).reduce((a, l) => a + (l.sizes?.[s] || 0), 0);
      drawAligned(sum ? String(sum) : '', xOf(i), c.w, y - 9, 'c', 8, bold, dark);
    } else if (c.key === 'qty') {
      drawAligned(String(po.total_qty || 0), xOf(i), c.w, y - 9, 'r', 8, bold, dark);
    } else if (c.key === 'amount') {
      drawAligned((po.total_amount || 0).toFixed(2), xOf(i), c.w, y - 9, 'r', 8, bold, dark);
    }
  });
  y -= rowH + 24;

  // ---- Footer ----
  newPageIfNeeded();
  draw('Pack model: a quantity applies to every colour of that style/size unless a specific colour is named.', margin, Math.max(margin, y), 7.5, font, grey);
  draw(`Generated ${new Date().toLocaleString()} · Tintura`, margin, margin - 6, 7.5, font, grey);

  return await pdf.save();
};
