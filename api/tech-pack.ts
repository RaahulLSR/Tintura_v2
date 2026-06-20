// =====================================================================
// TINTURA TECH-PACK — standalone printable tech-pack page (no login).
// Renders the SAME layout as the ERP "Generate Tech-Pack PDF" print view
// so the bot can hand out a single shareable link the user can open and
// "Save as PDF". Usage: GET /api/tech-pack?style=1004
// =====================================================================
import { fetchStyleByNumber, fetchStyleTemplate } from '../services/db.js';
import { getStyleCustomItems, getStyleMainImage } from '../types.js';
import type { Style, StyleTemplate, Attachment } from '../types.js';

const esc = (v: any) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ratioLabel = (type?: string, val?: any) =>
  type ? `${val} ${type === 'items_per_pc' ? 'pcs/garment' : 'garments/pc'}` : '';

const renderAttachmentsHtml = (attachments: Attachment[] = []) => {
  if (!attachments || attachments.length === 0) return '';
  const images = attachments.filter((a) => a.type === 'image');
  const docs = attachments.filter((a) => a.type === 'document');
  let html = '';
  if (images.length) {
    html += '<div class="att-grid">';
    images.forEach((img) => {
      html += `<figure class="att"><img src="${esc(img.url)}"/><figcaption>${esc(img.name)}</figcaption></figure>`;
    });
    html += '</div>';
  }
  if (docs.length) {
    html += '<div class="doc-row">';
    docs.forEach((doc) => {
      html += `<a class="doc-chip" href="${esc(doc.url)}" target="_blank" rel="noopener">📎 ${esc(doc.name)}</a>`;
    });
    html += '</div>';
  }
  return html;
};

const buildTechPackHtml = (style: Style, template: StyleTemplate): string => {
  const categories = (template?.config || []).filter((c) => c.name !== 'General Info');

  const techPackHtml = categories
    .map((cat) => {
      const rows = cat.fields
        .map((f) => {
          const item = style.tech_pack[cat.name]?.[f];
          if (!item || (!item.text && !(item.attachments || []).length && !(item.variants || []).length)) return '';
          let contentHtml = '';
          if (item.variants && item.variants.length) {
            contentHtml = item.variants
              .map((v) => {
                let sizeHtml = '';
                if (v.sizeVariants && v.sizeVariants.length) {
                  sizeHtml = v.sizeVariants
                    .map(
                      (sv) => `
                            <div class="sv">
                                <span class="chips">${sv.sizes.map((sz) => `<span class="chip chip-size">${esc(sz)}</span>`).join('')}${sv.consumption_type ? `<span class="chip chip-ratio">${esc(ratioLabel(sv.consumption_type, sv.consumption_val))}</span>` : ''}</span>
                                <span class="sv-text">${esc(sv.text) || '—'}</span>
                                ${renderAttachmentsHtml(sv.attachments)}
                            </div>`,
                    )
                    .join('');
                }
                return `
                      <div class="variant">
                        <div class="variant-head">
                          <span class="chips">${v.colors.map((c) => `<span class="chip chip-color">${esc(c)}</span>`).join('')}${v.consumption_type ? `<span class="chip chip-ratio">${esc(ratioLabel(v.consumption_type, v.consumption_val))}</span>` : ''}</span>
                          <span class="variant-text">${esc(v.text) || '—'}</span>
                        </div>
                        ${renderAttachmentsHtml(v.attachments)}
                        ${sizeHtml}
                      </div>`;
              })
              .join('');
          } else {
            contentHtml = `<div class="cell-text">${esc(item.text) || '—'}${item.consumption_type ? ` <span class="chip chip-ratio">${esc(ratioLabel(item.consumption_type, item.consumption_val))}</span>` : ''}</div>${renderAttachmentsHtml(item.attachments)}`;
          }
          return `<tr><th class="spec">${esc(f)}</th><td class="detail">${contentHtml}</td></tr>`;
        })
        .filter(Boolean)
        .join('');
      if (!rows) return '';
      return `
            <table class="spec-table">
              <thead><tr><th class="cat-head" colspan="2">${esc(cat.name)}</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`;
    })
    .filter(Boolean)
    .join('');

  const customItems = getStyleCustomItems(style);
  const customNames = Object.keys(customItems);
  const customHtml = customNames.length
    ? `
        <table class="spec-table">
          <thead><tr><th class="cat-head" colspan="2">Additional Specifications</th></tr></thead>
          <tbody>
            ${customNames
              .map((name) => {
                const item: any = customItems[name];
                const body = `<div class="cell-text">${esc(item.text) || '—'}</div>${renderAttachmentsHtml(item.attachments || [])}`;
                return `<tr><th class="spec">${esc(name)}</th><td class="detail">${body}</td></tr>`;
              })
              .join('')}
          </tbody>
        </table>`
    : '';

  const mainImg = getStyleMainImage(style);
  const heroHtml = mainImg ? `<div class="hero"><img src="${esc(mainImg)}"/></div>` : '';

  return `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <meta name="viewport" content="width=device-width, initial-scale=1"/>
          <title>Tech Pack — ${esc(style.style_number)}</title>
          <style>
            * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            body { font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; margin: 0; padding: 0; font-size: 9.5px; color: #111827; line-height: 1.35; background: #e2e8f0; }
            .page { max-width: 800px; margin: 0 auto; padding: 12px 16px 16px; background: #fff; }

            .toolbar { position: sticky; top: 0; z-index: 10; background: #0f172a; color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; font-size: 13px; }
            .toolbar b { letter-spacing: 1px; }
            .toolbar button { background: #4338ca; color: #fff; border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
            @media print { .toolbar { display: none; } }

            .masthead { display: flex; align-items: stretch; border: 1.5px solid #0f172a; border-radius: 4px; overflow: hidden; }
            .mh-brand { background: #0f172a; color: #fff; padding: 7px 12px; display: flex; flex-direction: column; justify-content: center; }
            .mh-brand b { font-size: 13px; font-weight: 900; letter-spacing: 1.5px; }
            .mh-brand small { font-size: 6.5px; font-weight: 700; letter-spacing: 2px; color: #94a3b8; margin-top: 1px; }
            .mh-style { flex: 1; display: flex; align-items: center; padding: 7px 14px; }
            .mh-style .num { font-size: 18px; font-weight: 900; color: #4338ca; letter-spacing: .5px; }
            .mh-style .sub { font-size: 8px; color: #475569; font-weight: 600; text-transform: uppercase; letter-spacing: .6px; margin-left: 10px; }
            .mh-doc { text-align: right; padding: 7px 12px; border-left: 1px solid #e2e8f0; display: flex; flex-direction: column; justify-content: center; }
            .mh-doc small { font-size: 6.5px; font-weight: 700; letter-spacing: 1.5px; color: #94a3b8; text-transform: uppercase; }
            .mh-doc b { font-size: 9px; font-weight: 800; color: #0f172a; }

            .strip { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden; margin-top: 8px; }
            .strip .c { padding: 4px 9px; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
            .strip .c:nth-child(4n) { border-right: none; }
            .strip .label { font-size: 6.5px; text-transform: uppercase; color: #94a3b8; font-weight: 800; letter-spacing: .6px; }
            .strip .value { font-size: 10px; font-weight: 800; color: #0f172a; margin-top: 1px; }

            .topgrid { display: grid; grid-template-columns: ${mainImg ? '180px 1fr' : '1fr'}; gap: 10px; margin-top: 8px; align-items: start; }
            .hero { border: 1px solid #e2e8f0; border-radius: 4px; background: #f8fafc; display: flex; align-items: center; justify-content: center; max-height: 180px; overflow: hidden; }
            .hero img { max-width: 100%; max-height: 180px; width: auto; height: auto; object-fit: contain; display: block; }
            .palette-box { display: grid; gap: 6px; }
            .pbox { border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 9px; background: #f8fafc; }
            .pbox .label { font-size: 6.5px; text-transform: uppercase; color: #94a3b8; font-weight: 800; letter-spacing: .6px; }
            .chips { display: inline-flex; flex-wrap: wrap; gap: 3px; align-items: center; }
            .pbox .chips { margin-top: 4px; }
            .chip { font-size: 8px; font-weight: 700; padding: 1.5px 7px; border-radius: 999px; letter-spacing: .2px; white-space: nowrap; }
            .chip-color { background: #fff; color: #334155; border: 1px solid #cbd5e1; text-transform: uppercase; }
            .chip-size { background: #4338ca; color: #fff; }
            .chip-ratio { background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe; }

            .summary { margin-top: 8px; padding: 6px 10px; border: 1px solid #e2e8f0; border-left: 3px solid #4338ca; border-radius: 4px; background: #f8fafc; font-size: 9px; color: #334155; white-space: pre-wrap; line-height: 1.4; }

            .spec-table { width: 100%; border-collapse: collapse; margin-top: 10px; border: 1px solid #cbd5e1; break-inside: auto; }
            .spec-table .cat-head { background: #0f172a; color: #fff; text-align: left; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 4px 10px; }
            .spec-table th.spec { width: 110px; vertical-align: top; text-align: left; font-size: 8px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: .4px; padding: 5px 10px; background: #f1f5f9; border-top: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; }
            .spec-table td.detail { vertical-align: top; padding: 5px 10px; border-top: 1px solid #e5e7eb; }
            .spec-table tr { break-inside: avoid; }
            .cell-text { font-size: 9.5px; font-weight: 600; color: #0f172a; }

            .variant { border: 1px solid #e2e8f0; border-radius: 4px; background: #f8fafc; padding: 5px 8px; margin-top: 5px; break-inside: avoid; }
            .variant:first-child { margin-top: 0; }
            .variant-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
            .variant-text { font-size: 9.5px; font-weight: 600; color: #0f172a; }
            .sv { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #d8dee9; }
            .sv-text { font-size: 9px; font-weight: 600; color: #1e293b; }

            .att-grid { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 5px; margin-top: 5px; }
            .att { margin: 0; border: 1px solid #e2e8f0; border-radius: 4px; overflow: hidden; background: #fff; break-inside: avoid; }
            .att img { display: block; max-width: 130px; max-height: 110px; width: auto; height: auto; }
            .att figcaption { padding: 2px 4px; font-size: 6px; font-weight: 600; color: #64748b; text-align: center; border-top: 1px solid #eef2f7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; }
            .doc-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
            .doc-chip { font-size: 7.5px; font-weight: 600; color: #4338ca; background: #eef2ff; border: 1px solid #c7d2fe; padding: 2px 6px; border-radius: 4px; text-decoration: none; }

            .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
            .footer .org { font-size: 7px; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: .8px; }
            .footer .id { font-size: 6.5px; color: #cbd5e1; }

            @media print {
              body { background: #fff; }
              .page { padding: 0; max-width: none; }
              @page { margin: 8mm; }
            }
          </style>
        </head>
        <body>
          <div class="toolbar"><b>TECH PACK · ${esc(style.style_number)}</b><button onclick="window.print()">🖨️ Save as PDF</button></div>
          <div class="page">
            <div class="masthead">
              <div class="mh-brand"><b>TINTURA SST</b><small>FACTORY SPEC SHEET</small></div>
              <div class="mh-style"><span class="num">${esc(style.style_number)}</span><span class="sub">${esc(style.category)} · ${esc(style.garment_type || '—')} · ${esc(style.demographic || '—')}</span></div>
              <div class="mh-doc"><small>Issued</small><b>${new Date().toLocaleDateString()}</b></div>
            </div>

            <div class="strip">
              <div class="c"><div class="label">Style No</div><div class="value">${esc(style.style_number)}</div></div>
              <div class="c"><div class="label">Category</div><div class="value">${esc(style.category)}</div></div>
              <div class="c"><div class="label">Garment</div><div class="value">${esc(style.garment_type || 'N/A')}</div></div>
              <div class="c"><div class="label">Segment</div><div class="value">${esc(style.demographic || 'N/A')}</div></div>
              <div class="c"><div class="label">Packing</div><div class="value">${esc(style.packing_type)}</div></div>
              <div class="c"><div class="label">Pcs / Box</div><div class="value">${esc(style.pcs_per_box)}</div></div>
              <div class="c"><div class="label">Size Type</div><div class="value">${esc(style.size_type || '—')}</div></div>
              <div class="c"><div class="label">Colors / Sizes</div><div class="value">${(style.available_colors || []).filter(Boolean).length} / ${(style.available_sizes || []).length}</div></div>
            </div>

            <div class="topgrid">
              ${heroHtml}
              <div class="palette-box">
                <div class="pbox">
                  <span class="label">Approved Palette</span>
                  <div class="chips">${(style.available_colors || []).filter((c) => c).map((c) => `<span class="chip chip-color">${esc(c)}</span>`).join('') || '<span class="chip chip-color">—</span>'}</div>
                </div>
                <div class="pbox">
                  <span class="label">Size Grid (${esc(style.size_type)})</span>
                  <div class="chips">${(style.available_sizes || []).map((s) => `<span class="chip chip-size">${esc(s)}</span>`).join('') || '<span class="chip chip-size">—</span>'}</div>
                </div>
              </div>
            </div>

            <div class="summary">${esc(style.style_text) || 'Standard technical construction procedures apply. No specific summary provided.'}</div>

            ${techPackHtml}
            ${customHtml}

            <div class="footer">
              <div class="org">Tintura SST · Factory Spec Sheet</div>
              <div class="id">ID ${esc(style.id)} · ${new Date().toLocaleString()}</div>
            </div>
          </div>
        </body>
      </html>`;
};

export default async function handler(req: any, res: any) {
  const styleNumber = String((req.query?.style ?? '') || '').split(' - ')[0].trim();
  if (!styleNumber) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send('<p style="font-family:sans-serif;padding:24px">Missing ?style= parameter.</p>');
  }
  try {
    const [style, template] = await Promise.all([fetchStyleByNumber(styleNumber), fetchStyleTemplate()]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!style) {
      return res.status(404).send(`<p style="font-family:sans-serif;padding:24px">Style "${esc(styleNumber)}" not found.</p>`);
    }
    if (!template) {
      return res.status(500).send('<p style="font-family:sans-serif;padding:24px">Tech-pack template not configured.</p>');
    }
    return res.status(200).send(buildTechPackHtml(style, template));
  } catch (e: any) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`<p style="font-family:sans-serif;padding:24px">Error: ${esc(e?.message || 'unknown')}</p>`);
  }
}
