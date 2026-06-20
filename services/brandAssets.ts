// =====================================================================
// TINTURA brand assets as framework-agnostic strings, so the SAME logo
// can be embedded in generated documents (PDF cover HTML, emails, print
// reports). Pure inline styles — safe across email clients & print.
// =====================================================================

export const BRAND = {
  ink: '#0b0b0c', // logo background / near-black
  amber: '#f5a623', // accent dots
  white: '#ffffff',
  muted: '#64748b',
};

/**
 * Public URL of the round "Feel the cool" brand sticker (served from /public).
 * Used as the top-left mark on every generated document.
 */
export const STICKER_URL = 'https://tintura-sst.vercel.app/tintura-sticker.png';

/**
 * Standard document header: the "Feel the cool" sticker in the TOP-LEFT and
 * the TINTURA® · CASUALS logo lockup in the TOP-RIGHT, with an optional
 * subtitle caption. Table layout + inline styles — safe across email & print.
 */
export const brandHeaderHtml = (subtitle = ''): string => `
<table role="presentation" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-bottom:10px;">
  <tr>
    <td align="left" valign="middle" style="width:78px;">
      <img src="${STICKER_URL}" alt="Tintura — Feel the cool" width="64" height="64" style="display:block;border:0;outline:none;" />
    </td>
    <td align="right" valign="middle">
      <div style="display:inline-block;background:${BRAND.ink};border-radius:10px;padding:8px 16px;">
        <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${BRAND.amber};vertical-align:middle;"></span>
        <span style="color:${BRAND.white};font-weight:800;font-size:22px;letter-spacing:3px;vertical-align:middle;margin:0 8px;">TINTURA</span>
        <span style="color:${BRAND.white};font-size:10px;vertical-align:top;">&reg;</span>
        <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${BRAND.amber};vertical-align:middle;margin-left:8px;"></span>
      </div>
      <div style="font-size:9px;font-weight:700;letter-spacing:5px;color:${BRAND.muted};margin-top:5px;text-align:center;">CASUALS</div>
      ${subtitle ? `<div style="font-size:11px;font-weight:700;letter-spacing:1px;color:${BRAND.muted};text-transform:uppercase;margin-top:7px;">${subtitle}</div>` : ''}
    </td>
  </tr>
</table>`;

/**
 * The horizontal "TINTURA® · CASUALS" wordmark (image2 style): heavy black
 * "TINTURA" flanked by amber dots with a registered mark, and a spaced
 * "C A S U A L S" caption beneath — on a transparent background (no box).
 */
export const brandWordmarkHtml = (): string => `
<div style="display:inline-block;font-family:Arial,Helvetica,sans-serif;text-align:center;white-space:nowrap;">
  <div style="line-height:1;">
    <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${BRAND.amber};vertical-align:middle;"></span>
    <span style="color:${BRAND.ink};font-weight:900;font-size:30px;letter-spacing:4px;vertical-align:middle;margin-left:10px;">TINTURA</span><span style="color:${BRAND.ink};font-size:12px;font-weight:700;vertical-align:top;margin-left:-4px;">&reg;</span>
    <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${BRAND.amber};vertical-align:middle;margin-left:10px;"></span>
  </div>
  <div style="font-size:11px;font-weight:700;letter-spacing:9px;color:${BRAND.ink};margin-top:3px;padding-left:9px;">CASUALS</div>
</div>`;

/**
 * Printable job-sheet header: the round "Feel the cool" sticker on the LEFT
 * and the horizontal TINTURA® · CASUALS wordmark on the RIGHT, with an
 * optional subtitle. Table layout + inline styles — safe across print engines.
 */
export const brandHeaderDualLogoHtml = (subtitle = ''): string => `
<table role="presentation" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-bottom:10px;">
  <tr>
    <td align="left" valign="middle" style="width:78px;">
      <img src="${STICKER_URL}" alt="Tintura — Feel the cool" width="64" height="64" style="display:block;border:0;outline:none;" />
    </td>
    <td align="right" valign="middle">
      ${brandWordmarkHtml()}
      ${subtitle ? `<div style="font-size:11px;font-weight:700;letter-spacing:1px;color:${BRAND.muted};text-transform:uppercase;margin-top:7px;">${subtitle}</div>` : ''}
    </td>
  </tr>
</table>`;

/**
 * The round "CASUALS" sticker/seal — a small brand mark for document footers.
 */
export const brandSealHtml = (label = 'CASUALS'): string => `
<div style="display:inline-block;width:70px;height:70px;border-radius:50%;background:${BRAND.ink};border:3px solid ${BRAND.amber};font-family:Arial,Helvetica,sans-serif;text-align:center;line-height:1.15;">
  <div style="color:${BRAND.white};font-weight:800;font-size:13px;letter-spacing:1px;margin-top:20px;">TINTURA</div>
  <div style="color:${BRAND.amber};font-weight:700;font-size:8px;letter-spacing:3px;">${label}</div>
</div>`;
