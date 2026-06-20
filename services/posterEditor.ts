/*
 * Poster Editor – fully algorithmic (no AI) overlay engine.
 *
 *  - Element model: text / box / image, each with position, size, rotation, opacity.
 *  - renderPoster(): deterministic canvas renderer used for the final export
 *    (the on-screen editor uses DOM elements from the SAME model, so it's WYSIWYG).
 *  - Reusable library stored in localStorage:
 *      • assets    = single saved elements (a styled box, a text, a logo) to re-insert.
 *      • templates = whole saved layouts to apply to any style.
 *  - Text supports {{tokens}} that auto-fill from the current style.
 */

export type ElType = 'text' | 'box' | 'image';

export interface BaseEl {
  id: string;
  type: ElType;
  x: number;
  y: number;
  w: number;
  h: number; // for text, height is auto (ignored on render)
  rotation: number;
  opacity: number;
}

export interface TextEl extends BaseEl {
  type: 'text';
  text: string;
  fontSize: number;
  fontWeight: number; // 400 | 600 | 700 | 800 | 900
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number; // multiplier
  letterSpacing: number; // px
  bg: string; // 'none' or color
  radius: number;
  padX: number;
  padY: number;
}

export interface BoxEl extends BaseEl {
  type: 'box';
  fill: string; // 'none' or color
  radius: number;
  borderColor: string;
  borderWidth: number;
  text?: string;        // optional label rendered centered inside the box
  textColor?: string;
  fontSize?: number;
  fontWeight?: number;
  textAlign?: 'left' | 'center' | 'right';
}

export interface ImageEl extends BaseEl {
  type: 'image';
  src: string;
  radius: number;
  brightness?: number; // 1 = normal
  contrast?: number;   // 1 = normal
  saturate?: number;   // 1 = normal
  grayscale?: boolean;
  flipH?: boolean;
  flipV?: boolean;
  hue?: number;        // degrees, 0 = normal
  sepia?: number;      // 0..1, 0 = off
  invert?: boolean;
  blur?: number;       // px, 0 = off
}

export type El = TextEl | BoxEl | ImageEl;

export interface PosterBase {
  src: string;
  fit: 'cover' | 'contain';
  bg: string;
}

export interface StagePreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const STAGE_PRESETS: StagePreset[] = [
  { id: '45', label: 'Portrait 4:5', w: 1080, h: 1350 },
  { id: '11', label: 'Square 1:1', w: 1080, h: 1080 },
  { id: '34', label: 'Portrait 3:4', w: 1080, h: 1440 },
  { id: '916', label: 'Story 9:16', w: 1080, h: 1920 },
];

export const STYLE_TOKENS: { token: string; label: string }[] = [
  { token: '{{style_number}}', label: 'Style number' },
  { token: '{{garment_type}}', label: 'Garment type' },
  { token: '{{demographic}}', label: 'Age / fit' },
  { token: '{{category}}', label: 'Category' },
  { token: '{{sizes}}', label: 'Size range' },
  { token: '{{colour}}', label: 'Colour' },
  { token: '{{pcs_per_box}}', label: 'Pcs / box' },
  { token: '{{packing_type}}', label: 'Packing type' },
];

const uid = () => Math.random().toString(36).slice(2, 9);

export const applyTokens = (text: string, style: any): string => {
  if (!text || !style) return text || '';
  const map: Record<string, string> = {
    style_number: style.style_number || '',
    garment_type: style.garment_type || '',
    demographic: style.demographic || '',
    category: style.category || '',
    sizes: Array.isArray(style.available_sizes) ? style.available_sizes.join(', ') : '',
    colour: Array.isArray(style.available_colors) ? style.available_colors[0] || '' : '',
    pcs_per_box: style.pcs_per_box != null ? String(style.pcs_per_box) : '',
    packing_type: style.packing_type || '',
  };
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in map ? map[k] : `{{${k}}}`));
};

/* ---------------- element factories ---------------- */

export const newText = (over: Partial<TextEl> = {}): TextEl => ({
  id: uid(),
  type: 'text',
  x: 120,
  y: 120,
  w: 600,
  h: 80,
  rotation: 0,
  opacity: 1,
  text: 'Double-click to edit',
  fontSize: 48,
  fontWeight: 800,
  italic: false,
  color: '#0b0b0c',
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  bg: 'none',
  radius: 0,
  padX: 0,
  padY: 0,
  ...over,
});

export const newBox = (over: Partial<BoxEl> = {}): BoxEl => ({
  id: uid(),
  type: 'box',
  x: 120,
  y: 120,
  w: 480,
  h: 220,
  rotation: 0,
  opacity: 1,
  fill: '#ef4444',
  radius: 28,
  borderColor: '#000000',
  borderWidth: 0,
  ...over,
});

export const newImage = (src: string, over: Partial<ImageEl> = {}): ImageEl => ({
  id: uid(),
  type: 'image',
  x: 60,
  y: 60,
  w: 220,
  h: 220,
  rotation: 0,
  opacity: 1,
  src,
  radius: 0,
  ...over,
});

/** Re-id an element (used when inserting a saved asset / template). */
export const cloneEl = (el: El, dx = 24, dy = 24): El =>
  ({ ...el, id: uid(), x: el.x + dx, y: el.y + dy } as El);

/* ---------------- preset info-blocks (match the brand card) ---------------- */

export const presetBadge = (): El[] => [
  newText({
    x: 120, y: 60, w: 520, fontSize: 56, fontWeight: 900, align: 'center',
    color: '#16a34a', bg: '#ffffff', radius: 24, padX: 28, padY: 18,
    text: 'Special DryFit',
  }),
];

export const presetTitlePill = (): El[] => [
  newText({
    x: 120, y: 220, w: 560, fontSize: 60, fontWeight: 900, align: 'center',
    color: '#ffffff', bg: '#ef4444', radius: 32, padX: 30, padY: 22,
    text: '{{style_number}} {{garment_type}}',
  }),
];

export const presetSpecBlock = (): El[] => [
  newText({
    x: 120, y: 430, w: 700, fontSize: 40, fontWeight: 800, align: 'center', lineHeight: 1.3,
    color: '#0b0b0c', bg: 'none',
    text: 'Style No : {{style_number}}\n{{garment_type}}\n{{category}} Fabrics',
  }),
];

export const presetManufacturer = (): El[] => [
  newBox({ x: 90, y: 1120, w: 900, h: 180, fill: '#ffffff', radius: 20, borderColor: '#cbd5e1', borderWidth: 3 }),
  newText({
    x: 110, y: 1135, w: 860, fontSize: 30, fontWeight: 700, align: 'center', lineHeight: 1.35,
    color: '#334155', bg: 'none',
    text: 'Manufactured by\nSREYEAS CREATIONS\n48C, KVP Layout, Tirupur - 641 604, INDIA',
  }),
];

/* ---------------- white-background removal ---------------- */

export const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });

/** Turn near-white pixels transparent. tolerance 0-60 (higher removes more). */
export const removeWhiteBackground = async (src: string, tolerance = 30): Promise<string> => {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const cut = 255 - tolerance;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] >= cut && d[i + 1] >= cut && d[i + 2] >= cut) d[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
};

/* ---------------- touch-up (brightness / contrast / saturation / grayscale) ---------------- */

/** CSS/canvas filter string from an image element's adjustments ('none' when untouched). */
export const imageFilter = (im: {
  brightness?: number; contrast?: number; saturate?: number; grayscale?: boolean;
  hue?: number; sepia?: number; invert?: boolean; blur?: number;
}): string => {
  const b = im.brightness ?? 1, c = im.contrast ?? 1, s = im.saturate ?? 1;
  const hue = im.hue ?? 0, sep = im.sepia ?? 0, blur = im.blur ?? 0;
  const parts: string[] = [];
  if (b !== 1) parts.push(`brightness(${b})`);
  if (c !== 1) parts.push(`contrast(${c})`);
  if (s !== 1) parts.push(`saturate(${s})`);
  if (hue) parts.push(`hue-rotate(${hue}deg)`);
  if (sep) parts.push(`sepia(${sep})`);
  if (im.grayscale) parts.push('grayscale(1)');
  if (im.invert) parts.push('invert(1)');
  if (blur) parts.push(`blur(${blur}px)`);
  return parts.length ? parts.join(' ') : 'none';
};

/* ---------------- content-aware fill (algorithmic inpaint) ---------------- */

/**
 * Fill the masked region of `canvas` using the surrounding pixels (Laplace
 * diffusion / heat-equation inpainting). `mask` is a same-sized canvas where any
 * pixel with alpha > 10 marks an area to be replaced. Works great for erasing
 * small artifacts / logos on relatively smooth backgrounds ("magic fill").
 */
export const inpaint = (canvas: HTMLCanvasElement, mask: HTMLCanvasElement): void => {
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  const ctx = canvas.getContext('2d')!;
  const md = mask.getContext('2d')!.getImageData(0, 0, w, h).data;

  // bounding box of the masked region
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (md[(y * w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return;
  const pad = 3;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const bw = maxX - minX + 1, bh = maxY - minY + 1;

  const img = ctx.getImageData(minX, minY, bw, bh);
  const d = img.data;
  const masked = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      masked[y * bw + x] = md[((y + minY) * w + (x + minX)) * 4 + 3] > 10 ? 1 : 0;
    }
  }

  const R = new Float32Array(bw * bh), G = new Float32Array(bw * bh), B = new Float32Array(bw * bh);
  let sr = 0, sg = 0, sb = 0, cnt = 0;
  for (let i = 0; i < bw * bh; i++) {
    R[i] = d[i * 4]; G[i] = d[i * 4 + 1]; B[i] = d[i * 4 + 2];
    if (!masked[i]) { sr += R[i]; sg += G[i]; sb += B[i]; cnt++; }
  }
  if (cnt === 0) return; // nothing to sample from
  const ar = sr / cnt, ag = sg / cnt, ab = sb / cnt;
  for (let i = 0; i < bw * bh; i++) {
    if (masked[i]) { R[i] = ar; G[i] = ag; B[i] = ab; }
  }

  const iters = Math.min(450, Math.max(40, Math.round(Math.max(bw, bh) * 1.6)));
  const R2 = R.slice(), G2 = G.slice(), B2 = B.slice();
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        if (!masked[i]) continue;
        let n = 0, rr = 0, gg = 0, bb = 0;
        if (x > 0) { const j = i - 1; rr += R[j]; gg += G[j]; bb += B[j]; n++; }
        if (x < bw - 1) { const j = i + 1; rr += R[j]; gg += G[j]; bb += B[j]; n++; }
        if (y > 0) { const j = i - bw; rr += R[j]; gg += G[j]; bb += B[j]; n++; }
        if (y < bh - 1) { const j = i + bw; rr += R[j]; gg += G[j]; bb += B[j]; n++; }
        if (n) { R2[i] = rr / n; G2[i] = gg / n; B2[i] = bb / n; }
      }
    }
    for (let i = 0; i < bw * bh; i++) {
      if (masked[i]) { R[i] = R2[i]; G[i] = G2[i]; B[i] = B2[i]; }
    }
  }

  for (let i = 0; i < bw * bh; i++) {
    if (masked[i]) { d[i * 4] = R[i]; d[i * 4 + 1] = G[i]; d[i * 4 + 2] = B[i]; d[i * 4 + 3] = 255; }
  }
  ctx.putImageData(img, minX, minY);
};

/* ---------------- one-click destructive enhancers ---------------- */

/** Auto levels: stretch each channel between its 0.5% and 99.5% percentile. */
export const autoEnhance = async (src: string): Promise<string> => {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const total = c.width * c.height;
  const lo = [0, 0, 0], hi = [255, 255, 255];
  for (let ch = 0; ch < 3; ch++) {
    const hist = new Uint32Array(256);
    for (let i = ch; i < d.length; i += 4) hist[d[i]]++;
    const clip = total * 0.005;
    let acc = 0, lv = 0, hv = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > clip) { lv = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > clip) { hv = v; break; } }
    lo[ch] = lv; hi[ch] = Math.max(lv + 1, hv);
  }
  for (let i = 0; i < d.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const v = (d[i + ch] - lo[ch]) * 255 / (hi[ch] - lo[ch]);
      d[i + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
};

/** Unsharp-style sharpen via a 3x3 convolution. amount 0..1.5. */
export const sharpen = async (src: string, amount = 0.7): Promise<string> => {
  const img = await loadImage(src);
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const src2 = ctx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  const s = src2.data, o = out.data;
  const a = amount, center = 1 + 4 * a;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let v = s[i + ch] * center;
        if (x > 0) v -= s[i - 4 + ch] * a;
        if (x < w - 1) v -= s[i + 4 + ch] * a;
        if (y > 0) v -= s[i - w * 4 + ch] * a;
        if (y < h - 1) v -= s[i + w * 4 + ch] * a;
        o[i + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      o[i + 3] = s[i + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
  return c.toDataURL('image/png');
};

/* ---------------- crop (fractional rectangle 0..1 of the source) ---------------- */

export const cropImage = async (
  src: string, fx: number, fy: number, fw: number, fh: number,
): Promise<{ src: string; w: number; h: number }> => {
  const img = await loadImage(src);
  const nx = Math.max(0, Math.min(1, fx));
  const ny = Math.max(0, Math.min(1, fy));
  const sx = nx * img.naturalWidth;
  const sy = ny * img.naturalHeight;
  const sw = Math.max(1, Math.min(1 - nx, fw) * img.naturalWidth);
  const sh = Math.max(1, Math.min(1 - ny, fh) * img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = Math.round(sw); c.height = Math.round(sh);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return { src: c.toDataURL('image/png'), w: c.width, h: c.height };
};

export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('Could not read file'));
    fr.readAsDataURL(file);
  });

export const dataUrlToFile = (dataUrl: string, name: string): File => {
  const [head, b64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
};

/* ---------------- canvas renderer (export = source of truth) ---------------- */

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const wd of words) {
      const test = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = wd;
      } else line = test;
    }
    out.push(line);
  }
  return out;
};

export const textBlockHeight = (
  ctx: CanvasRenderingContext2D,
  el: TextEl,
  resolvedText: string,
): { lines: string[]; height: number } => {
  ctx.font = `${el.italic ? 'italic ' : ''}${el.fontWeight} ${el.fontSize}px Inter, Arial, sans-serif`;
  try { (ctx as any).letterSpacing = `${el.letterSpacing}px`; } catch { /* noop */ }
  const lines = wrapText(ctx, resolvedText, el.w - el.padX * 2);
  const height = el.padY * 2 + lines.length * el.fontSize * el.lineHeight;
  return { lines, height };
};

export interface RenderOpts {
  stageW: number;
  stageH: number;
  base: PosterBase | null;
  elements: El[];
  style: any;
}

export const renderPoster = async (opts: RenderOpts): Promise<string> => {
  const { stageW, stageH, base, elements, style } = opts;
  const c = document.createElement('canvas');
  c.width = stageW;
  c.height = stageH;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = base?.bg || '#ffffff';
  ctx.fillRect(0, 0, stageW, stageH);

  if (base?.src) {
    try {
      const img = await loadImage(base.src);
      const s =
        base.fit === 'cover'
          ? Math.max(stageW / img.width, stageH / img.height)
          : Math.min(stageW / img.width, stageH / img.height);
      const w = img.width * s;
      const h = img.height * s;
      ctx.drawImage(img, stageW / 2 - w / 2, stageH / 2 - h / 2, w, h);
    } catch { /* ignore */ }
  }

  for (const el of elements) {
    ctx.save();
    ctx.globalAlpha = el.opacity;
    const rad = (el.rotation * Math.PI) / 180;

    if (el.type === 'text') {
      const resolved = applyTokens(el.text, style);
      const { lines, height } = textBlockHeight(ctx, el, resolved);
      const cx = el.x + el.w / 2;
      const cy = el.y + height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(rad);
      ctx.translate(-el.w / 2, -height / 2);
      if (el.bg !== 'none') {
        roundRect(ctx, 0, 0, el.w, height, el.radius);
        ctx.fillStyle = el.bg;
        ctx.fill();
      }
      ctx.fillStyle = el.color;
      ctx.font = `${el.italic ? 'italic ' : ''}${el.fontWeight} ${el.fontSize}px Inter, Arial, sans-serif`;
      try { (ctx as any).letterSpacing = `${el.letterSpacing}px`; } catch { /* noop */ }
      ctx.textBaseline = 'top';
      ctx.textAlign = el.align;
      const tx = el.align === 'center' ? el.w / 2 : el.align === 'right' ? el.w - el.padX : el.padX;
      lines.forEach((ln, i) => {
        ctx.fillText(ln, tx, el.padY + i * el.fontSize * el.lineHeight);
      });
    } else if (el.type === 'box') {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(rad);
      ctx.translate(-el.w / 2, -el.h / 2);
      roundRect(ctx, 0, 0, el.w, el.h, el.radius);
      if (el.fill !== 'none') { ctx.fillStyle = el.fill; ctx.fill(); }
      if (el.borderWidth > 0) { ctx.lineWidth = el.borderWidth; ctx.strokeStyle = el.borderColor; ctx.stroke(); }
      const label = (el.text || '').trim();
      if (label) {
        const fs = el.fontSize ?? 32;
        const fw = el.fontWeight ?? 800;
        const align = el.textAlign ?? 'center';
        const pad = 14;
        ctx.fillStyle = el.textColor ?? '#ffffff';
        ctx.font = `${fw} ${fs}px Inter, Arial, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = align;
        const resolved = applyTokens(label, style);
        const lines = wrapText(ctx, resolved, el.w - pad * 2);
        const lh = fs * 1.2;
        const startY = el.h / 2 - ((lines.length - 1) * lh) / 2;
        const tx = align === 'center' ? el.w / 2 : align === 'right' ? el.w - pad : pad;
        lines.forEach((ln, i) => ctx.fillText(ln, tx, startY + i * lh));
      }
    } else if (el.type === 'image') {
      try {
        const img = await loadImage(el.src);
        const cx = el.x + el.w / 2;
        const cy = el.y + el.h / 2;
        ctx.translate(cx, cy);
        ctx.rotate(rad);
        if (el.flipH || el.flipV) ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1);
        ctx.translate(-el.w / 2, -el.h / 2);
        const s = Math.min(el.w / img.width, el.h / img.height);
        const w = img.width * s;
        const h = img.height * s;
        ctx.filter = imageFilter(el);
        if (el.radius > 0) { roundRect(ctx, 0, 0, el.w, el.h, el.radius); ctx.clip(); }
        ctx.drawImage(img, el.w / 2 - w / 2, el.h / 2 - h / 2, w, h);
      } catch { /* ignore */ }
    }
    ctx.restore();
  }

  return c.toDataURL('image/png');
};

/* ---------------- reusable library (localStorage) ---------------- */

export interface SavedAsset { id: string; name: string; element: El; createdAt: number }
export interface SavedTemplate { id: string; name: string; stageW: number; stageH: number; elements: El[]; createdAt: number }

const ASSETS_KEY = 'tintura_poster_assets';
const TEMPLATES_KEY = 'tintura_poster_templates';

const read = <T>(key: string): T[] => {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
};
const write = (key: string, val: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
};

export const listAssets = (): SavedAsset[] => read<SavedAsset>(ASSETS_KEY).sort((a, b) => b.createdAt - a.createdAt);
export const saveAsset = (name: string, element: El): SavedAsset => {
  const asset: SavedAsset = { id: uid(), name, element, createdAt: Date.now() };
  write(ASSETS_KEY, [asset, ...listAssets()]);
  return asset;
};
export const deleteAsset = (id: string) => write(ASSETS_KEY, listAssets().filter(a => a.id !== id));

export const listTemplates = (): SavedTemplate[] => read<SavedTemplate>(TEMPLATES_KEY).sort((a, b) => b.createdAt - a.createdAt);
export const saveTemplate = (name: string, stageW: number, stageH: number, elements: El[]): SavedTemplate => {
  const tpl: SavedTemplate = { id: uid(), name, stageW, stageH, elements, createdAt: Date.now() };
  write(TEMPLATES_KEY, [tpl, ...listTemplates()]);
  return tpl;
};
export const deleteTemplate = (id: string) => write(TEMPLATES_KEY, listTemplates().filter(t => t.id !== id));
