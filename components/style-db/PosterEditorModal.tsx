import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Type, Square, Image as ImageIcon, Upload, Trash2, Copy, Save, Download,
  Loader2, Sparkles, Layers, ChevronUp, ChevronDown, Bookmark, FolderOpen,
  Eraser, AlignLeft, AlignCenter, AlignRight, Italic, Star,
  Crop, FlipHorizontal, FlipVertical, SlidersHorizontal, Paintbrush, Check, RotateCcw,
  Wand2, Aperture, Zap, Maximize,
  Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Lock, Unlock, Eye, EyeOff, Grid3x3, GripVertical,
} from 'lucide-react';
import { Style, Attachment, getStylePoster } from '../../types';
import {
  uploadOrderAttachment,
  fetchPosterAssets, fetchPosterTemplates, savePosterAssetRemote, savePosterTemplateRemote, deletePosterLibraryItem,
} from '../../services/db';
import { STICKER_URL } from '../../services/brandAssets';
import {
  El, TextEl, BoxEl, ImageEl, PosterBase, STAGE_PRESETS, STYLE_TOKENS, FONT_OPTIONS, curvedCharLayout,
  newText, newBox, newImage, cloneEl, applyTokens, renderPoster, removeWhiteBackground,
  fileToDataUrl, dataUrlToFile, loadImage, imageFilter, cropImage,
  inpaint, autoEnhance, sharpen,
  presetBadge, presetTitlePill, presetSpecBlock, presetManufacturer,
  listAssets, saveAsset, deleteAsset, listTemplates, saveTemplate, deleteTemplate,
  SavedAsset, SavedTemplate,
} from '../../services/posterEditor';

interface Props {
  style: Style;
  onClose: () => void;
  onPosterReady: (attachment: Attachment) => void;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 space-y-2">
    <h4 className="font-black text-slate-500 text-[10px] uppercase tracking-widest">{title}</h4>
    {children}
  </div>
);

const Num: React.FC<{ label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }> = ({ label, value, onChange, step = 1, min }) => (
  <label className="flex-1 min-w-[60px]">
    <span className="block text-[9px] font-bold text-slate-400 uppercase mb-0.5">{label}</span>
    <input type="number" value={Math.round(value)} step={step} min={min}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500" />
  </label>
);

const Color: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <label className="flex items-center gap-2">
    <input type="color" value={value === 'none' ? '#ffffff' : value} onChange={e => onChange(e.target.value)} className="w-7 h-7 rounded border border-slate-200 cursor-pointer" />
    <span className="text-[10px] font-bold text-slate-500">{label}</span>
  </label>
);

/* a free-form canvas size — width/height can be anything the user wants */
const CUSTOM_PRESET = { id: 'custom', label: 'Custom', w: 1080, h: 1080 };

export const PosterEditorModal: React.FC<Props> = ({ style, onClose, onPosterReady }) => {
  const poster = getStylePoster(style);
  const [preset, setPreset] = useState<typeof STAGE_PRESETS[number] | typeof CUSTOM_PRESET>(STAGE_PRESETS[0]);
  const [customSize, setCustomSize] = useState<{ w: number; h: number }>({ w: 1080, h: 1080 });
  const [base, setBase] = useState<PosterBase | null>(null);
  const [elements, setElements] = useState<El[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [assets, setAssets] = useState<SavedAsset[]>([]);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const cloudRef = useRef(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  /* zoom / pan / grid / snap */
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const gridSize = 60;
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [showLayers, setShowLayers] = useState(true);
  const measureCanvas = useMemo(() => document.createElement('canvas').getContext('2d')!, []);

  /* image-editing tools */
  const [tool, setTool] = useState<'move' | 'erase' | 'crop'>('move');
  const [brush, setBrush] = useState(36);
  const [eraseMode, setEraseMode] = useState<'erase' | 'fill' | 'restore'>('erase');
  const [editKind, setEditKind] = useState<'el' | 'base'>('el');
  const eraseWorkRef = useRef<HTMLCanvasElement | null>(null);
  const eraseOrigRef = useRef<HTMLImageElement | null>(null);
  const eraseOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const eraseMaskRef = useRef<HTMLCanvasElement | null>(null);
  const erasingRef = useRef(false);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropKind, setCropKind] = useState<'el' | 'base'>('el');

  const fileRef = useRef<HTMLInputElement>(null);
  const baseFileRef = useRef<HTMLInputElement>(null);

  const stageW = preset.id === 'custom' ? customSize.w : preset.w;
  const stageH = preset.id === 'custom' ? customSize.h : preset.h;
  const maxW = 480, maxH = 600;
  const baseScale = Math.min(maxW / stageW, maxH / stageH);
  const scale = baseScale * zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const sel = elements.find(e => e.id === selId) || null;

  /* live refs + undo/redo history (captures the pre-edit state after a short idle) */
  const elementsRef = useRef(elements); elementsRef.current = elements;
  const baseRef = useRef(base); baseRef.current = base;
  type Snap = { elements: El[]; base: PosterBase | null };
  const undoStack = useRef<Snap[]>([]);
  const redoStack = useRef<Snap[]>([]);
  const applyingHistory = useRef(false);
  const lastSnapRef = useRef<Snap>({ elements, base });
  const commitTimer = useRef<any>(null);
  const [, setHistVer] = useState(0);
  useEffect(() => {
    if (applyingHistory.current) { applyingHistory.current = false; lastSnapRef.current = { elements, base }; return; }
    if (commitTimer.current) clearTimeout(commitTimer.current);
    const pre = lastSnapRef.current;
    commitTimer.current = setTimeout(() => {
      undoStack.current.push(pre);
      if (undoStack.current.length > 80) undoStack.current.shift();
      redoStack.current = [];
      lastSnapRef.current = { elements: elementsRef.current, base: baseRef.current };
      commitTimer.current = null;
      setHistVer(v => v + 1);
    }, 300);
  }, [elements, base]);
  const undo = () => {
    let target: Snap;
    if (commitTimer.current) { clearTimeout(commitTimer.current); commitTimer.current = null; target = lastSnapRef.current; }
    else { if (!undoStack.current.length) return; target = undoStack.current.pop()!; }
    redoStack.current.push({ elements: elementsRef.current, base: baseRef.current });
    applyingHistory.current = true;
    setElements(target.elements); setBase(target.base); setSelId(null); setHistVer(v => v + 1);
  };
  const redo = () => {
    if (commitTimer.current) { clearTimeout(commitTimer.current); commitTimer.current = null; undoStack.current.push(lastSnapRef.current); }
    if (!redoStack.current.length) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push({ elements: elementsRef.current, base: baseRef.current });
    applyingHistory.current = true;
    setElements(next.elements); setBase(next.base); setSelId(null); setHistVer(v => v + 1);
  };

  const patch = (id: string, p: Partial<El>) =>
    setElements(els => els.map(e => (e.id === id ? ({ ...e, ...p } as El) : e)));
  const patchSel = (p: Partial<El>) => sel && patch(sel.id, p);

  const add = (el: El) => { setElements(els => [...els, el]); setSelId(el.id); };
  const addMany = (els: El[]) => { setElements(prev => [...prev, ...els]); setSelId(els[els.length - 1]?.id || null); };

  const removeEl = (id: string) => { setElements(els => els.filter(e => e.id !== id)); setSelId(null); };
  const duplicate = (id: string) => {
    const el = elements.find(e => e.id === id); if (!el) return;
    const c = cloneEl(el); setElements(els => [...els, c]); setSelId(c.id);
  };
  const reorder = (id: string, dir: -1 | 1) => {
    setElements(els => {
      const i = els.findIndex(e => e.id === id); if (i < 0) return els;
      const j = i + dir; if (j < 0 || j >= els.length) return els;
      const next = [...els]; [next[i], next[j]] = [next[j], next[i]]; return next;
    });
  };

  /* ---------- layers ---------- */
  const moveLayer = (id: string, toIndex: number) => {
    setElements(els => {
      const i = els.findIndex(e => e.id === id); if (i < 0) return els;
      const arr = [...els]; const [it] = arr.splice(i, 1);
      arr.splice(Math.max(0, Math.min(arr.length, toIndex)), 0, it); return arr;
    });
  };
  const toggleLock = (id: string) => setElements(els => els.map(e => e.id === id ? ({ ...e, locked: !e.locked } as El) : e));
  const toggleHidden = (id: string) => setElements(els => els.map(e => e.id === id ? ({ ...e, hidden: !e.hidden } as El) : e));
  const renameLayer = (id: string, name: string) => setElements(els => els.map(e => e.id === id ? ({ ...e, name } as El) : e));
  const layerLabel = (el: El) => el.name
    || (el.type === 'text' ? (applyTokens((el as TextEl).text, style).replace(/\s+/g, ' ').trim().slice(0, 18) || 'Text')
      : el.type === 'image' ? 'Image' : 'Box');

  /* ---------- align (to canvas) & distribute (all elements) ---------- */
  const alignSel = (where: 'l' | 'c' | 'r' | 't' | 'm' | 'b') => {
    if (!sel) return;
    if (where === 'l') patchSel({ x: 0 });
    else if (where === 'c') patchSel({ x: Math.round(stageW / 2 - sel.w / 2) });
    else if (where === 'r') patchSel({ x: Math.round(stageW - sel.w) });
    else if (where === 't') patchSel({ y: 0 });
    else if (where === 'm') patchSel({ y: Math.round(stageH / 2 - sel.h / 2) });
    else if (where === 'b') patchSel({ y: Math.round(stageH - sel.h) });
  };
  const distribute = (axis: 'h' | 'v') => {
    setElements(els => {
      if (els.length < 3) return els;
      const c = (e: El) => axis === 'h' ? e.x + e.w / 2 : e.y + e.h / 2;
      const sorted = [...els].sort((a, b) => c(a) - c(b));
      const first = c(sorted[0]), last = c(sorted[sorted.length - 1]);
      const step = (last - first) / (sorted.length - 1);
      const upd = new Map<string, Partial<El>>();
      sorted.forEach((e, i) => {
        if (i === 0 || i === sorted.length - 1) return;
        const center = first + step * i;
        upd.set(e.id, axis === 'h' ? { x: Math.round(center - e.w / 2) } : { y: Math.round(center - e.h / 2) });
      });
      return els.map(e => upd.has(e.id) ? ({ ...e, ...upd.get(e.id) } as El) : e);
    });
  };
  const fitZoom = () => setZoom(1);

  /* drag / resize */
  const drag = useRef<any>(null);
  const onMove = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / scaleRef.current;
    const dy = (e.clientY - d.sy) / scaleRef.current;
    if (d.mode === 'move') {
      let nx = d.o.x + dx, ny = d.o.y + dy;
      const w = d.o.w, h = d.o.h;
      const vg: number[] = [], hg: number[] = [];
      if (snapEnabled) {
        const SNAP = 7 / scaleRef.current;
        const vT = [0, stageW / 2, stageW];
        const hT = [0, stageH / 2, stageH];
        for (const o of elementsRef.current) { if (o.id === d.id || o.hidden) continue; vT.push(o.x, o.x + o.w / 2, o.x + o.w); hT.push(o.y, o.y + o.h / 2, o.y + o.h); }
        let bestX: { t: number; diff: number; adj: number } | null = null;
        for (const t of vT) for (const a of [nx, nx + w / 2, nx + w]) { const diff = Math.abs(a - t); if (diff <= SNAP && (!bestX || diff < bestX.diff)) bestX = { t, diff, adj: t - a }; }
        if (bestX) { nx += bestX.adj; vg.push(bestX.t); }
        let bestY: { t: number; diff: number; adj: number } | null = null;
        for (const t of hT) for (const a of [ny, ny + h / 2, ny + h]) { const diff = Math.abs(a - t); if (diff <= SNAP && (!bestY || diff < bestY.diff)) bestY = { t, diff, adj: t - a }; }
        if (bestY) { ny += bestY.adj; hg.push(bestY.t); }
        if (showGrid && !bestX) { const g = Math.round(nx / gridSize) * gridSize; if (Math.abs(g - nx) <= SNAP) nx = g; }
        if (showGrid && !bestY) { const g = Math.round(ny / gridSize) * gridSize; if (Math.abs(g - ny) <= SNAP) ny = g; }
      }
      setGuides({ v: vg, h: hg });
      patch(d.id, { x: Math.round(nx), y: Math.round(ny) });
    }
    else if (d.mode === 'resize') {
      const w = Math.max(24, Math.round(d.o.w + dx));
      if (d.type === 'text') patch(d.id, { w });
      else if (d.type === 'image') {
        const ratio = d.o.h / d.o.w;
        patch(d.id, { w, h: Math.max(24, Math.round(w * ratio)) });
      } else patch(d.id, { w, h: Math.max(24, Math.round(d.o.h + dy)) });
    }
  };
  const onUp = () => {
    drag.current = null;
    setGuides({ v: [], h: [] });
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  const startDrag = (e: React.PointerEvent, el: El, mode: 'move' | 'resize') => {
    e.stopPropagation();
    if (tool !== 'move') return;
    if (el.locked) return;
    setSelId(el.id);
    drag.current = { mode, id: el.id, type: el.type, sx: e.clientX, sy: e.clientY, o: { x: el.x, y: el.y, w: el.w, h: el.h } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  useEffect(() => () => onUp(), []);

  /* base image — sizing the canvas to the picture so nothing is cropped/squashed */
  const applyBaseSrc = async (src: string) => {
    setBase({ src, fit: 'contain', bg: '#ffffff' });
    try {
      const img = await loadImage(src);
      setCustomSize({ w: img.naturalWidth, h: img.naturalHeight });
      setPreset(CUSTOM_PRESET);
    } catch { /* keep the current canvas if the image can't be measured */ }
  };
  const pickBaseFile = async (file?: File) => {
    if (!file) return;
    const src = await fileToDataUrl(file);
    await applyBaseSrc(src);
  };
  const pickBaseExisting = (url: string) => { applyBaseSrc(url); };
  const fitCanvasToBase = async () => {
    if (!base?.src) return;
    try {
      const img = await loadImage(base.src);
      setCustomSize({ w: img.naturalWidth, h: img.naturalHeight });
      setPreset(CUSTOM_PRESET);
      setBase({ ...base, fit: 'contain' });
    } catch { /* ignore */ }
  };

  /* add image element */
  const addImageFile = async (file?: File) => {
    if (!file) return;
    const src = await fileToDataUrl(file);
    try {
      const img = await loadImage(src);
      const w = 320; const h = Math.round((img.naturalHeight / img.naturalWidth) * w);
      add(newImage(src, { x: 80, y: 80, w, h }));
    } catch { add(newImage(src)); }
  };
  const addSticker = () => add(newImage(STICKER_URL, { x: 40, y: 40, w: 200, h: 200 }));

  /* Ctrl+V — paste an image straight from the clipboard onto the poster. */
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const file = it.getAsFile();
          if (!file) continue;
          e.preventDefault();
          const src = await fileToDataUrl(file);
          let el: El;
          try {
            const img = await loadImage(src);
            const w = 320; const h = Math.round((img.naturalHeight / img.naturalWidth) * w);
            el = newImage(src, { x: 80, y: 80, w, h });
          } catch { el = newImage(src); }
          setElements(els => [...els, el]);
          setSelId(el.id);
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  /* white removal for selected image */
  const [tol, setTol] = useState(30);
  const removeWhite = async () => {
    if (!sel || sel.type !== 'image') return;
    setBusy(true);
    try { const out = await removeWhiteBackground((sel as ImageEl).src, tol); patch(sel.id, { src: out } as Partial<ImageEl>); }
    finally { setBusy(false); }
  };

  /* contained image rect inside its box (stage units) */
  const imgContain = (im: ImageEl, natW: number, natH: number) => {
    const ar = natW / natH, boxAr = im.w / im.h;
    let cw: number, ch: number;
    if (ar > boxAr) { cw = im.w; ch = im.w / ar; } else { ch = im.h; cw = im.h * ar; }
    return { offX: (im.w - cw) / 2, offY: (im.h - ch) / 2, cw, ch };
  };

  /* ---------- object eraser / magic-fill (brush, on element OR base) ---------- */
  const startEraseFrom = async (src: string, kind: 'el' | 'base') => {
    setBusy(true);
    try {
      const img = await loadImage(src);
      eraseOrigRef.current = img;
      const work = document.createElement('canvas');
      work.width = img.naturalWidth; work.height = img.naturalHeight;
      work.getContext('2d')!.drawImage(img, 0, 0);
      eraseWorkRef.current = work;
      const mask = document.createElement('canvas');
      mask.width = img.naturalWidth; mask.height = img.naturalHeight;
      eraseMaskRef.current = mask;
      setEditKind(kind);
      setTool('erase');
    } finally { setBusy(false); }
  };
  const startErase = () => { if (sel && sel.type === 'image') startEraseFrom((sel as ImageEl).src, 'el'); };
  const startEraseBase = () => { if (base?.src) { setSelId(null); startEraseFrom(base.src, 'base'); } };

  const blitErase = () => {
    const ov = eraseOverlayRef.current, work = eraseWorkRef.current, mask = eraseMaskRef.current;
    if (!ov || !work) return;
    const octx = ov.getContext('2d')!;
    octx.clearRect(0, 0, ov.width, ov.height);
    octx.drawImage(work, 0, 0, ov.width, ov.height);
    if (mask) { octx.save(); octx.globalAlpha = 0.55; octx.drawImage(mask, 0, 0, ov.width, ov.height); octx.restore(); }
  };
  const eraseAt = (e: React.PointerEvent) => {
    const work = eraseWorkRef.current, orig = eraseOrigRef.current, ov = eraseOverlayRef.current, mask = eraseMaskRef.current;
    if (!work || !ov) return;
    const r = ov.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * work.width;
    const ny = ((e.clientY - r.top) / r.height) * work.height;
    const rad = (brush / 2) * (work.width / r.width);
    if (eraseMode === 'fill') {
      if (!mask) return;
      const mctx = mask.getContext('2d')!;
      mctx.fillStyle = 'rgba(244,63,94,1)';
      mctx.beginPath(); mctx.arc(nx, ny, rad, 0, Math.PI * 2); mctx.fill();
      blitErase();
      return;
    }
    const wctx = work.getContext('2d')!;
    wctx.save();
    if (eraseMode === 'erase') {
      wctx.globalCompositeOperation = 'destination-out';
      wctx.beginPath(); wctx.arc(nx, ny, rad, 0, Math.PI * 2); wctx.fill();
    } else if (orig) {
      wctx.globalCompositeOperation = 'source-over';
      wctx.beginPath(); wctx.arc(nx, ny, rad, 0, Math.PI * 2); wctx.closePath(); wctx.clip();
      wctx.drawImage(orig, 0, 0);
    }
    wctx.restore();
    blitErase();
  };
  const endStroke = () => {
    erasingRef.current = false;
    const work = eraseWorkRef.current, mask = eraseMaskRef.current;
    if (eraseMode === 'fill' && work && mask) {
      inpaint(work, mask);
      mask.getContext('2d')!.clearRect(0, 0, mask.width, mask.height);
      blitErase();
    }
  };
  const clearEraseRefs = () => {
    eraseWorkRef.current = null; eraseOrigRef.current = null; eraseMaskRef.current = null;
  };
  const commitErase = () => {
    const work = eraseWorkRef.current;
    if (work) {
      const out = work.toDataURL('image/png');
      if (editKind === 'base' && base) setBase({ ...base, src: out });
      else if (sel && sel.type === 'image') patch(sel.id, { src: out } as Partial<ImageEl>);
    }
    clearEraseRefs(); setTool('move'); setEditKind('el');
  };
  const cancelErase = () => { clearEraseRefs(); setTool('move'); setEditKind('el'); };
  useEffect(() => { if (tool === 'erase') blitErase(); }, [tool, selId, eraseMode]);

  const eraseGeom = () => {
    const img = eraseOrigRef.current;
    if (tool !== 'erase' || !img) return null;
    if (editKind === 'base') {
      if (!base) return null;
      const s = Math.min(dispW / img.naturalWidth, dispH / img.naturalHeight);
      const cw = img.naturalWidth * s, ch = img.naturalHeight * s;
      return { left: (dispW - cw) / 2, top: (dispH - ch) / 2, w: Math.max(1, Math.round(cw)), h: Math.max(1, Math.round(ch)) };
    }
    if (!sel || sel.type !== 'image') return null;
    const im = sel as ImageEl;
    const { offX, offY, cw, ch } = imgContain(im, img.naturalWidth, img.naturalHeight);
    return {
      left: (im.x + offX) * scale, top: (im.y + offY) * scale,
      w: Math.max(1, Math.round(cw * scale)), h: Math.max(1, Math.round(ch * scale)),
    };
  };

  /* ---------- one-click enhancers (element or base) ---------- */
  const enhanceImg = async (mode: 'auto' | 'sharpen', target: 'el' | 'base') => {
    const src = target === 'base' ? base?.src : (sel?.type === 'image' ? (sel as ImageEl).src : null);
    if (!src) return;
    setBusy(true);
    try {
      const out = mode === 'auto' ? await autoEnhance(src) : await sharpen(src, 0.7);
      if (target === 'base' && base) setBase({ ...base, src: out });
      else if (sel && sel.type === 'image') patch(sel.id, { src: out } as Partial<ImageEl>);
    } finally { setBusy(false); }
  };

  /* ---------- crop ---------- */
  const startCrop = () => {
    if (!sel || sel.type !== 'image') return;
    const im = sel as ImageEl;
    setCropKind('el');
    setCrop({ x: im.w * 0.1, y: im.h * 0.1, w: im.w * 0.8, h: im.h * 0.8 });
    setTool('crop');
  };
  const startCropBase = () => {
    if (!base?.src) return;
    setSelId(null);
    setCropKind('base');
    setCrop({ x: stageW * 0.08, y: stageH * 0.08, w: stageW * 0.84, h: stageH * 0.84 });
    setTool('crop');
  };
  const cropDrag = useRef<any>(null);
  const cropMove = (e: PointerEvent) => {
    const d = cropDrag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / scaleRef.current;
    const dy = (e.clientY - d.sy) / scaleRef.current;
    setCrop(c => c ? (d.mode === 'move'
      ? { ...c, x: d.o.x + dx, y: d.o.y + dy }
      : { ...c, w: Math.max(24, d.o.w + dx), h: Math.max(24, d.o.h + dy) }) : c);
  };
  const cropUp = () => { cropDrag.current = null; window.removeEventListener('pointermove', cropMove); window.removeEventListener('pointerup', cropUp); };
  const startCropDrag = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.stopPropagation();
    if (!crop) return;
    cropDrag.current = { mode, sx: e.clientX, sy: e.clientY, o: { ...crop } };
    window.addEventListener('pointermove', cropMove); window.addEventListener('pointerup', cropUp);
  };
  const applyCrop = async () => {
    if (!sel || sel.type !== 'image' || !crop) return;
    const im = sel as ImageEl;
    setBusy(true);
    try {
      const img = await loadImage(im.src);
      const { offX, offY, cw, ch } = imgContain(im, img.naturalWidth, img.naturalHeight);
      const res = await cropImage(im.src, (crop.x - offX) / cw, (crop.y - offY) / ch, crop.w / cw, crop.h / ch);
      const newW = Math.max(24, Math.round(crop.w));
      const newH = Math.max(24, Math.round(newW * (res.h / res.w)));
      patch(im.id, { src: res.src, x: Math.round(im.x + crop.x), y: Math.round(im.y + crop.y), w: newW, h: newH } as Partial<ImageEl>);
    } finally { setBusy(false); setCrop(null); setTool('move'); setCropKind('el'); }
  };
  /* crop the base image — the canvas becomes the cropped region and overlays follow it */
  const applyCropBase = async () => {
    if (!base?.src || !crop) return;
    setBusy(true);
    try {
      const img = await loadImage(base.src);
      const s = base.fit === 'cover'
        ? Math.max(stageW / img.naturalWidth, stageH / img.naturalHeight)
        : Math.min(stageW / img.naturalWidth, stageH / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const offX = stageW / 2 - dw / 2, offY = stageH / 2 - dh / 2;
      const res = await cropImage(base.src, (crop.x - offX) / dw, (crop.y - offY) / dh, crop.w / dw, crop.h / dh);
      const newW = Math.max(24, Math.round(crop.w));
      const newH = Math.max(24, Math.round(crop.h));
      const dx = crop.x, dy = crop.y;
      setBase({ ...base, src: res.src, fit: 'cover' });
      setCustomSize({ w: newW, h: newH });
      setPreset(CUSTOM_PRESET);
      setElements(els => els.map(e => ({ ...e, x: Math.round(e.x - dx), y: Math.round(e.y - dy) } as El)));
    } finally { setBusy(false); setCrop(null); setTool('move'); setCropKind('el'); }
  };
  const cancelCrop = () => { setCrop(null); setTool('move'); setCropKind('el'); };

  /* library (Supabase, with localStorage fallback) */
  const refreshLib = async () => {
    try {
      const [a, t] = await Promise.all([fetchPosterAssets(), fetchPosterTemplates()]);
      cloudRef.current = true;
      setAssets(a); setTemplates(t);
    } catch {
      cloudRef.current = false;
      setAssets(listAssets()); setTemplates(listTemplates());
    }
  };
  useEffect(() => { refreshLib(); }, []);

  const saveSelAsset = async () => {
    if (!sel) return;
    const name = prompt('Name this asset (e.g. "Red title pill", "TINTURA logo"):')?.trim();
    if (!name) return;
    if (cloudRef.current) {
      try { await savePosterAssetRemote(name, sel); await refreshLib(); return; } catch { cloudRef.current = false; }
    }
    saveAsset(name, sel); setAssets(listAssets());
  };
  const insertAsset = (a: SavedAsset) => add(cloneEl(a.element, 30, 30));
  const removeAsset = async (id: string) => {
    if (cloudRef.current) { try { await deletePosterLibraryItem(id); await refreshLib(); return; } catch { cloudRef.current = false; } }
    deleteAsset(id); setAssets(listAssets());
  };
  const saveAsTemplate = async () => {
    const name = prompt('Name this template (layout will be reusable for any style):')?.trim();
    if (!name) return;
    if (cloudRef.current) {
      try { await savePosterTemplateRemote(name, stageW, stageH, elements); await refreshLib(); return; } catch { cloudRef.current = false; }
    }
    saveTemplate(name, stageW, stageH, elements); setTemplates(listTemplates());
  };
  const loadTemplate = (t: SavedTemplate) => {
    const p = STAGE_PRESETS.find(s => s.w === t.stageW && s.h === t.stageH);
    if (p) setPreset(p);
    setElements(t.elements.map(e => ({ ...e, id: Math.random().toString(36).slice(2, 9) })));
    setSelId(null);
  };
  const removeTemplate = async (id: string) => {
    if (cloudRef.current) { try { await deletePosterLibraryItem(id); await refreshLib(); return; } catch { cloudRef.current = false; } }
    deleteTemplate(id); setTemplates(listTemplates());
  };

  /* export */
  const doRender = () => renderPoster({ stageW, stageH, base, elements, style });
  const download = async () => {
    setBusy(true);
    try {
      const url = await doRender();
      const a = document.createElement('a');
      a.href = url; a.download = `poster-${style.style_number || 'style'}.png`; a.click();
    } finally { setBusy(false); }
  };
  const saveToGallery = async () => {
    setSaving(true);
    try {
      const url = await doRender();
      const file = dataUrlToFile(url, `poster-${(style.style_number || 'style').replace(/\s+/g, '-')}-${Date.now()}.png`);
      const up = await uploadOrderAttachment(file);
      if (!up) { alert('Upload failed, please try again.'); return; }
      onPosterReady({ name: file.name, url: up, type: 'image' });
      onClose();
    } finally { setSaving(false); }
  };

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { if (e.shiftKey) redo(); else undo(); e.preventDefault(); return; }
      if (mod && e.key.toLowerCase() === 'y') { redo(); e.preventDefault(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { removeEl(selId); e.preventDefault(); return; }
      if (mod && e.key.toLowerCase() === 'd' && selId) { duplicate(selId); e.preventDefault(); return; }
      if (selId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const el = elementsRef.current.find(x => x.id === selId); if (!el || el.locked) return;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowUp') patch(selId, { y: el.y - step });
        if (e.key === 'ArrowDown') patch(selId, { y: el.y + step });
        if (e.key === 'ArrowLeft') patch(selId, { x: el.x - step });
        if (e.key === 'ArrowRight') patch(selId, { x: el.x + step });
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selId, elements]);

  const dispW = stageW * scale;
  const dispH = stageH * scale;

  /* render an element in the editing stage */
  const renderEl = (el: El) => {
    if (el.hidden) return null;
    const selected = el.id === selId;
    const common: React.CSSProperties = {
      position: 'absolute',
      left: el.x * scale,
      top: el.y * scale,
      width: el.w * scale,
      transform: `rotate(${el.rotation}deg)`,
      transformOrigin: 'center',
      opacity: el.opacity,
      cursor: el.locked ? 'default' : 'move',
    };
    let inner: React.ReactNode = null;
    if (el.type === 'text') {
      const t = el as TextEl;
      const fam = t.fontFamily || 'Inter, Arial, sans-serif';
      const textShadow = t.shadow ? `${(t.shadowX ?? 2) * scale}px ${(t.shadowY ?? 2) * scale}px ${(t.shadowBlur ?? 6) * scale}px ${t.shadowColor || 'rgba(0,0,0,0.5)'}` : undefined;
      const webkitStroke = (t.strokeWidth && t.strokeWidth > 0) ? `${t.strokeWidth * scale}px ${t.strokeColor || '#ffffff'}` : undefined;
      if (t.curve && Math.abs(t.curve) > 0.5) {
        measureCanvas.font = `${t.italic ? 'italic ' : ''}${t.fontWeight} ${t.fontSize}px ${fam}`;
        const measure = (ch: string) => measureCanvas.measureText(ch).width + (t.letterSpacing || 0);
        const { placed, width, height } = curvedCharLayout(measure, applyTokens(t.text, style), t.fontSize, t.curve);
        inner = (
          <div style={{ position: 'relative', width: width * scale, height: height * scale }}>
            {placed.map((p, i) => (
              <span key={i} style={{
                position: 'absolute', left: p.x * scale, top: p.y * scale,
                transform: `translate(-50%, -50%) rotate(${p.angle * 180 / Math.PI}deg)`,
                color: t.color, fontSize: t.fontSize * scale, fontWeight: t.fontWeight,
                fontStyle: t.italic ? 'italic' : 'normal', fontFamily: fam, whiteSpace: 'pre',
                textShadow, WebkitTextStroke: webkitStroke as any,
              }}>{p.ch === ' ' ? '\u00a0' : p.ch}</span>
            ))}
          </div>
        );
      } else {
        inner = (
          <div style={{
            width: '100%',
            background: t.bg === 'none' ? 'transparent' : t.bg,
            borderRadius: t.radius * scale,
            padding: `${t.padY * scale}px ${t.padX * scale}px`,
            color: t.color,
            fontSize: t.fontSize * scale,
            fontWeight: t.fontWeight,
            fontStyle: t.italic ? 'italic' : 'normal',
            textAlign: t.align,
            lineHeight: t.lineHeight,
            letterSpacing: t.letterSpacing * scale,
            fontFamily: fam,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textShadow,
            WebkitTextStroke: webkitStroke as any,
          }}>{applyTokens(t.text, style)}</div>
        );
      }
    } else if (el.type === 'box') {
      const b = el as BoxEl;
      inner = <div style={{
        width: el.w * scale, height: el.h * scale,
        background: b.fill === 'none' ? 'transparent' : b.fill,
        borderRadius: b.radius * scale,
        border: b.borderWidth > 0 ? `${b.borderWidth * scale}px solid ${b.borderColor}` : 'none',
        display: 'flex', alignItems: 'center',
        justifyContent: (b.textAlign ?? 'center') === 'center' ? 'center' : (b.textAlign ?? 'center') === 'right' ? 'flex-end' : 'flex-start',
        padding: `0 ${14 * scale}px`, boxSizing: 'border-box', overflow: 'hidden',
      }}>
        {(b.text || '').trim() && (
          <span style={{
            color: b.textColor ?? '#ffffff',
            fontSize: (b.fontSize ?? 32) * scale,
            fontWeight: b.fontWeight ?? 800,
            textAlign: b.textAlign ?? 'center',
            lineHeight: 1.2,
            fontFamily: 'Inter, Arial, sans-serif',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            width: '100%',
          }}>{applyTokens(b.text || '', style)}</span>
        )}
      </div>;
    } else {
      const im = el as ImageEl;
      const f = imageFilter(im);
      inner = <img src={im.src} alt="" draggable={false} style={{
        width: el.w * scale, height: el.h * scale, objectFit: 'contain', borderRadius: im.radius * scale, display: 'block',
        filter: f === 'none' ? undefined : f,
        transform: (im.flipH || im.flipV) ? `scaleX(${im.flipH ? -1 : 1}) scaleY(${im.flipV ? -1 : 1})` : undefined,
        // hide the source image while erasing this element so the transparent
        // (erased) areas of the overlay reveal the stage behind, not the original
        visibility: selected && tool === 'erase' ? 'hidden' : undefined,
      }} />;
    }
    return (
      <div key={el.id} style={common} onPointerDown={e => startDrag(e, el, 'move')}>
        {inner}
        {selected && tool === 'move' && (
          <>
            <div className="absolute inset-0 ring-2 ring-indigo-500 pointer-events-none rounded-[2px]" />
            <div
              onPointerDown={e => startDrag(e, el, 'resize')}
              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-indigo-500 rounded-sm cursor-se-resize"
            />
          </>
        )}
      </div>
    );
  };

  /* shared eraser / magic-fill controls (used for elements and the base image) */
  const eraserPanel = (
    <Section title={editKind === 'base' ? 'Magic erase · base' : 'Object eraser'}>
      <p className="text-[10px] text-slate-400 font-medium">Paint over the image. <b>Erase</b> = delete pixels, <b>Magic fill</b> = remove an object by filling from nearby pixels, <b>Restore</b> = bring it back.</p>
      <div className="grid grid-cols-3 gap-1.5">
        <button onClick={() => setEraseMode('erase')} className={`px-1.5 py-1.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 ${eraseMode === 'erase' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Eraser size={12} /> Erase</button>
        <button onClick={() => setEraseMode('fill')} className={`px-1.5 py-1.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 ${eraseMode === 'fill' ? 'bg-fuchsia-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Wand2 size={12} /> Magic</button>
        <button onClick={() => setEraseMode('restore')} className={`px-1.5 py-1.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 ${eraseMode === 'restore' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Paintbrush size={12} /> Restore</button>
      </div>
      {eraseMode === 'fill' && <p className="text-[9px] text-fuchsia-600 font-bold">Paint over the object, then release — it fills from the surrounding background.</p>}
      <label className="block">
        <span className="text-[9px] font-bold text-slate-400 uppercase">Brush size {brush}px</span>
        <input type="range" min={8} max={140} value={brush} onChange={e => setBrush(Number(e.target.value))} className="w-full accent-indigo-600" />
      </label>
      <div className="flex items-center gap-1.5">
        <button onClick={commitErase} className="flex-1 px-2 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black hover:bg-indigo-700 flex items-center justify-center gap-1"><Check size={12} /> Apply</button>
        <button onClick={cancelErase} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black">Cancel</button>
      </div>
    </Section>
  );

  /* crop controls for the base image (elements have their own inline panel) */
  const baseCropPanel = (
    <Section title="Crop · base">
      <p className="text-[10px] text-slate-400 font-medium">Drag the box to position, drag the corner to resize, then apply. The canvas becomes the cropped area.</p>
      <div className="flex items-center gap-1.5">
        <button onClick={applyCropBase} disabled={busy} className="flex-1 px-2 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center gap-1">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Apply crop</button>
        <button onClick={cancelCrop} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black">Cancel</button>
      </div>
    </Section>
  );

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-3 animate-fade-in">
      <div className="bg-slate-100 w-full max-w-[1300px] h-[94vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white grid place-items-center shadow"><Sparkles size={16} /></div>
            <div>
              <h3 className="font-black text-slate-800 text-sm leading-tight">Poster Editor</h3>
              <p className="text-[11px] text-slate-400 font-medium">{style.style_number} · drag, style & save reusable overlays</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={download} disabled={busy} className="px-3 py-2 rounded-xl text-xs font-black bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center gap-1.5 disabled:opacity-40"><Download size={14} /> PNG</button>
            <button onClick={saveToGallery} disabled={saving} className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5 disabled:opacity-40">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save to gallery</button>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[290px_1fr_300px]">
          {/* LEFT TOOLS */}
          <div className="overflow-y-auto p-3 space-y-3 border-r border-slate-200">
            <Section title="Canvas">
              <select value={preset.id} onChange={e => { const v = e.target.value; setPreset(v === 'custom' ? CUSTOM_PRESET : STAGE_PRESETS.find(p => p.id === v)!); }} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none">
                {STAGE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label} ({p.w}×{p.h})</option>)}
                <option value="custom">Custom / any size</option>
              </select>
              {preset.id === 'custom' && (
                <div className="flex items-end gap-1.5">
                  <Num label="W (px)" value={customSize.w} min={32} onChange={v => setCustomSize(s => ({ ...s, w: Math.max(32, Math.round(v)) }))} />
                  <Num label="H (px)" value={customSize.h} min={32} onChange={v => setCustomSize(s => ({ ...s, h: Math.max(32, Math.round(v)) }))} />
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={() => baseFileRef.current?.click()} className="flex-1 px-2 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-black hover:bg-indigo-700 flex items-center justify-center gap-1"><Upload size={12} /> Base image</button>
                <input ref={baseFileRef} type="file" accept="image/*" className="hidden" onChange={e => { pickBaseFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
              </div>
              {base && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setBase({ ...base, fit: base.fit === 'cover' ? 'contain' : 'cover' })} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black">{base.fit}</button>
                  <Color label="BG" value={base.bg} onChange={v => setBase({ ...base, bg: v })} />
                  <button onClick={() => setBase(null)} className="ml-auto p-1.5 rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                </div>
              )}
              {base && (
                <div className="space-y-1.5 pt-1 border-t border-slate-100">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Edit base image</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={fitCanvasToBase} disabled={busy} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black hover:bg-slate-200 disabled:opacity-40 flex items-center justify-center gap-1"><Maximize size={12} /> Fit canvas</button>
                    <button onClick={startCropBase} disabled={busy} className="px-2 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black hover:bg-indigo-100 disabled:opacity-40 flex items-center justify-center gap-1"><Crop size={12} /> Crop</button>
                  </div>
                  <button onClick={startEraseBase} disabled={busy} className="w-full px-2 py-1.5 rounded-lg bg-fuchsia-600 text-white text-[10px] font-black hover:bg-fuchsia-700 disabled:opacity-40 flex items-center justify-center gap-1"><Wand2 size={12} /> Magic erase / eraser</button>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={() => enhanceImg('auto', 'base')} disabled={busy} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black hover:bg-slate-200 disabled:opacity-40 flex items-center justify-center gap-1"><Zap size={12} /> Auto</button>
                    <button onClick={() => enhanceImg('sharpen', 'base')} disabled={busy} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black hover:bg-slate-200 disabled:opacity-40 flex items-center justify-center gap-1"><Aperture size={12} /> Sharpen</button>
                  </div>
                </div>
              )}
              {poster.images.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {poster.images.map((img, i) => (
                    <button key={i} onClick={() => pickBaseExisting(img.url)} className="aspect-square rounded-md overflow-hidden border border-slate-200 hover:border-indigo-500"><img src={img.url} alt="" className="w-full h-full object-cover" /></button>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Add element">
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => add(newText())} className="px-2 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-black flex items-center justify-center gap-1"><Type size={13} /> Text</button>
                <button onClick={() => add(newBox())} className="px-2 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-black flex items-center justify-center gap-1"><Square size={13} /> Box</button>
                <button onClick={() => fileRef.current?.click()} className="px-2 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-black flex items-center justify-center gap-1"><ImageIcon size={13} /> Image</button>
                <button onClick={addSticker} className="px-2 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-black flex items-center justify-center gap-1"><Star size={13} /> Sticker</button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { addImageFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            </Section>

            <Section title="Quick blocks">
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => addMany(presetBadge())} className="px-2 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black hover:bg-indigo-100">Badge</button>
                <button onClick={() => addMany(presetTitlePill())} className="px-2 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black hover:bg-indigo-100">Title pill</button>
                <button onClick={() => addMany(presetSpecBlock())} className="px-2 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black hover:bg-indigo-100">Spec text</button>
                <button onClick={() => addMany(presetManufacturer())} className="px-2 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black hover:bg-indigo-100">Maker box</button>
              </div>
            </Section>

            <Section title="My assets">
              <button onClick={saveSelAsset} disabled={!sel} className="w-full px-2 py-1.5 rounded-lg bg-amber-500 text-white text-[10px] font-black hover:bg-amber-600 disabled:opacity-40 flex items-center justify-center gap-1"><Bookmark size={12} /> Save selected as asset</button>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {assets.length === 0 && <p className="text-[10px] text-slate-400 font-medium text-center py-2">Save any element to reuse it.</p>}
                {assets.map(a => (
                  <div key={a.id} className="flex items-center gap-1 bg-slate-50 rounded-lg px-2 py-1">
                    <button onClick={() => insertAsset(a)} className="flex-1 text-left text-[11px] font-bold text-slate-600 truncate hover:text-indigo-600">{a.name}</button>
                    <button onClick={() => removeAsset(a.id)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Templates">
              <button onClick={saveAsTemplate} className="w-full px-2 py-1.5 rounded-lg bg-slate-700 text-white text-[10px] font-black hover:bg-slate-800 flex items-center justify-center gap-1"><FolderOpen size={12} /> Save layout as template</button>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {templates.length === 0 && <p className="text-[10px] text-slate-400 font-medium text-center py-2">No saved templates yet.</p>}
                {templates.map(t => (
                  <div key={t.id} className="flex items-center gap-1 bg-slate-50 rounded-lg px-2 py-1">
                    <button onClick={() => loadTemplate(t)} className="flex-1 text-left text-[11px] font-bold text-slate-600 truncate hover:text-indigo-600">{t.name}</button>
                    <button onClick={() => removeTemplate(t.id)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* CENTER STAGE */}
          <div className="flex flex-col min-h-0 bg-slate-200/60">
            {/* toolbar */}
            <div className="flex items-center flex-wrap gap-1.5 px-3 py-2 bg-white/70 border-b border-slate-200">
              <div className="flex items-center gap-1">
                <button onClick={undo} title="Undo (Ctrl+Z)" className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"><Undo2 size={15} /></button>
                <button onClick={redo} title="Redo (Ctrl+Y)" className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"><Redo2 size={15} /></button>
              </div>
              <div className="w-px h-5 bg-slate-200 mx-1" />
              <div className="flex items-center gap-1">
                <button onClick={() => setZoom(z => Math.max(0.2, +(z - 0.1).toFixed(2)))} title="Zoom out" className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"><ZoomOut size={15} /></button>
                <span className="text-[11px] font-black text-slate-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(4, +(z + 0.1).toFixed(2)))} title="Zoom in" className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"><ZoomIn size={15} /></button>
                <button onClick={fitZoom} title="Reset zoom (100%)" className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"><Maximize2 size={15} /></button>
              </div>
              <div className="w-px h-5 bg-slate-200 mx-1" />
              <button onClick={() => setShowGrid(g => !g)} title="Toggle grid" className={`p-1.5 rounded-lg ${showGrid ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Grid3x3 size={15} /></button>
              <button onClick={() => setSnapEnabled(s => !s)} title="Toggle snapping & guides" className={`px-2 py-1.5 rounded-lg text-[10px] font-black ${snapEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Snap</button>
              <div className="w-px h-5 bg-slate-200 mx-1" />
              <div className="flex items-center gap-0.5" title="Align selected to canvas">
                {(['l', 'c', 'r', 't', 'm', 'b'] as const).map(a => (
                  <button key={a} onClick={() => alignSel(a)} disabled={!sel} className="w-6 h-6 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30 text-[10px] font-black uppercase">{a}</button>
                ))}
              </div>
              <div className="w-px h-5 bg-slate-200 mx-1" />
              <button onClick={() => distribute('h')} title="Distribute all elements horizontally" className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-[10px] font-black">Dist H</button>
              <button onClick={() => distribute('v')} title="Distribute all elements vertically" className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-[10px] font-black">Dist V</button>
              <button onClick={() => sel && duplicate(sel.id)} disabled={!sel} title="Duplicate (Ctrl+D)" className="ml-auto p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30"><Copy size={15} /></button>
            </div>
            <div className="flex-1 overflow-auto grid place-items-center p-6"
              onPointerDown={() => { if (tool === 'move') setSelId(null); }}
              onWheel={e => { if (e.ctrlKey) { e.preventDefault(); setZoom(z => Math.max(0.2, Math.min(4, +(z - Math.sign(e.deltaY) * 0.1).toFixed(2)))); } }}
            >
              <div
                className="relative shadow-2xl"
                style={{ width: dispW, height: dispH, background: base?.bg || '#ffffff' }}
                onPointerDown={e => e.stopPropagation()}
              >
              {base?.src && (
                <img src={base.src} alt="" draggable={false}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: base.fit, pointerEvents: 'none', visibility: tool === 'erase' && editKind === 'base' ? 'hidden' : undefined }} />
              )}
              {elements.map(renderEl)}

              {/* grid overlay */}
              {showGrid && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundImage: 'linear-gradient(to right, rgba(99,102,241,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,0.16) 1px, transparent 1px)',
                  backgroundSize: `${gridSize * scale}px ${gridSize * scale}px`,
                }} />
              )}

              {/* snap / alignment guides */}
              {guides.v.map((x, i) => (<div key={'gv' + i} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: x * scale, width: 1, background: '#ec4899', zIndex: 40 }} />))}
              {guides.h.map((y, i) => (<div key={'gh' + i} className="absolute left-0 right-0 pointer-events-none" style={{ top: y * scale, height: 1, background: '#ec4899', zIndex: 40 }} />))}

              {/* eraser overlay */}
              {tool === 'erase' && (editKind === 'base' ? !!base : sel?.type === 'image') && (() => {
                const g = eraseGeom(); if (!g) return null;
                return (
                  <canvas
                    ref={eraseOverlayRef}
                    width={g.w} height={g.h}
                    style={{ position: 'absolute', left: g.left, top: g.top, width: g.w, height: g.h, cursor: 'crosshair', touchAction: 'none', zIndex: 30 }}
                    onPointerDown={e => { e.stopPropagation(); erasingRef.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); eraseAt(e); }}
                    onPointerMove={e => { if (erasingRef.current) eraseAt(e); }}
                    onPointerUp={endStroke}
                    onPointerLeave={endStroke}
                  />
                );
              })()}

              {/* crop overlay */}
              {tool === 'crop' && crop && (cropKind === 'base' ? !!base : sel?.type === 'image') && (
                <div
                  style={{ position: 'absolute', left: ((cropKind === 'base' ? 0 : (sel?.x ?? 0)) + crop.x) * scale, top: ((cropKind === 'base' ? 0 : (sel?.y ?? 0)) + crop.y) * scale, width: crop.w * scale, height: crop.h * scale, zIndex: 30, boxShadow: '0 0 0 9999px rgba(15,23,42,0.45)', cursor: 'move', touchAction: 'none' }}
                  onPointerDown={e => startCropDrag(e, 'move')}
                >
                  <div className="absolute inset-0 border-2 border-white/90" />
                  <div onPointerDown={e => startCropDrag(e, 'resize')} className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-sm cursor-se-resize" />
                </div>
              )}
            </div>
            </div>
          </div>

          {/* RIGHT PROPERTIES */}
          <div className="overflow-y-auto p-3 space-y-3 border-l border-slate-200">
            {elements.length > 0 && (
              <Section title={`Layers (${elements.length})`}>
                <div className="space-y-1 max-h-52 overflow-y-auto -mx-1 px-1">
                  {elements.map((_, i) => i).reverse().map(i => {
                    const el = elements[i];
                    const selected = el.id === selId;
                    return (
                      <div key={el.id}
                        draggable
                        onDragStart={e => e.dataTransfer.setData('layer-idx', String(i))}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); const from = Number(e.dataTransfer.getData('layer-idx')); if (!Number.isNaN(from)) moveLayer(elements[from].id, i); }}
                        onClick={() => { setSelId(el.id); setTool('move'); }}
                        className={`flex items-center gap-1 px-1.5 py-1 rounded-lg cursor-pointer ${selected ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50'}`}
                      >
                        <GripVertical size={13} className="text-slate-300 shrink-0 cursor-grab" />
                        <input value={el.name || ''} placeholder={layerLabel(el)} onClick={e => e.stopPropagation()}
                          onChange={e => renameLayer(el.id, e.target.value)}
                          className="flex-1 min-w-0 bg-transparent text-[11px] font-bold text-slate-600 outline-none truncate" />
                        <button onClick={e => { e.stopPropagation(); toggleHidden(el.id); }} title={el.hidden ? 'Show' : 'Hide'} className="p-1 rounded text-slate-400 hover:text-slate-700">{el.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
                        <button onClick={e => { e.stopPropagation(); toggleLock(el.id); }} title={el.locked ? 'Unlock' : 'Lock'} className="p-1 rounded text-slate-400 hover:text-slate-700">{el.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
                        <button onClick={e => { e.stopPropagation(); removeEl(el.id); }} title="Delete" className="p-1 rounded text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
            {tool === 'erase' && editKind === 'base' && eraserPanel}
            {tool === 'crop' && cropKind === 'base' && baseCropPanel}
            {!sel && !(tool === 'erase' && editKind === 'base') && !(tool === 'crop' && cropKind === 'base') && <div className="text-center text-slate-400 text-xs font-semibold py-10">Select an element to edit it.<br />Drag to move · drag the corner to resize.</div>}
            {sel && (
              <>
                <Section title="Layout">
                  <div className="flex gap-1.5">
                    <Num label="X" value={sel.x} onChange={v => patchSel({ x: v })} />
                    <Num label="Y" value={sel.y} onChange={v => patchSel({ y: v })} />
                  </div>
                  <div className="flex gap-1.5">
                    <Num label="W" value={sel.w} onChange={v => patchSel({ w: Math.max(24, v) })} />
                    {sel.type === 'box' && <Num label="H" value={sel.h} onChange={v => patchSel({ h: Math.max(24, v) })} />}
                  </div>
                  <label className="block">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Rotation {Math.round(sel.rotation)}°</span>
                    <input type="range" min={-180} max={180} value={sel.rotation} onChange={e => patchSel({ rotation: Number(e.target.value) })} className="w-full accent-indigo-600" />
                  </label>
                  <label className="block">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Opacity {Math.round(sel.opacity * 100)}%</span>
                    <input type="range" min={0} max={1} step={0.01} value={sel.opacity} onChange={e => patchSel({ opacity: Number(e.target.value) })} className="w-full accent-indigo-600" />
                  </label>
                  <div className="flex items-center gap-1.5 pt-1">
                    <button onClick={() => reorder(sel.id, 1)} className="flex-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black flex items-center justify-center gap-1"><ChevronUp size={12} /> Front</button>
                    <button onClick={() => reorder(sel.id, -1)} className="flex-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black flex items-center justify-center gap-1"><ChevronDown size={12} /> Back</button>
                    <button onClick={() => duplicate(sel.id)} className="p-1.5 rounded-lg bg-slate-100 text-slate-600"><Copy size={13} /></button>
                    <button onClick={() => removeEl(sel.id)} className="p-1.5 rounded-lg bg-red-50 text-red-500"><Trash2 size={13} /></button>
                  </div>
                </Section>

                {sel.type === 'text' && (() => {
                  const t = sel as TextEl;
                  return (
                    <Section title="Text">
                      <textarea value={t.text} onChange={e => patchSel({ text: e.target.value } as Partial<TextEl>)} rows={3}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 resize-none" />
                      <div className="flex flex-wrap gap-1">
                        {STYLE_TOKENS.map(tok => (
                          <button key={tok.token} onClick={() => patchSel({ text: `${t.text}${tok.token}` } as Partial<TextEl>)} title={tok.label}
                            className="px-1.5 py-0.5 rounded bg-slate-100 text-[9px] font-bold text-slate-500 hover:bg-indigo-100 hover:text-indigo-700">{tok.label}</button>
                        ))}
                      </div>
                      <div className="flex gap-1.5 items-end">
                        <Num label="Size" value={t.fontSize} onChange={v => patchSel({ fontSize: Math.max(6, v) } as Partial<TextEl>)} />
                        <select value={t.fontWeight} onChange={e => patchSel({ fontWeight: Number(e.target.value) } as Partial<TextEl>)} className="flex-1 px-1.5 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none">
                          {[400, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}
                        </select>
                        <button onClick={() => patchSel({ italic: !t.italic } as Partial<TextEl>)} className={`p-1.5 rounded-lg ${t.italic ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Italic size={13} /></button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Color label="Text" value={t.color} onChange={v => patchSel({ color: v } as Partial<TextEl>)} />
                        <div className="flex items-center gap-1 ml-auto">
                          {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
                            <button key={a} onClick={() => patchSel({ align: a } as Partial<TextEl>)} className={`p-1.5 rounded-lg ${t.align === a ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon size={13} /></button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => patchSel({ bg: t.bg === 'none' ? '#ef4444' : 'none' } as Partial<TextEl>)} className={`px-2 py-1 rounded-lg text-[10px] font-black ${t.bg === 'none' ? 'bg-slate-100 text-slate-500' : 'bg-indigo-600 text-white'}`}>{t.bg === 'none' ? 'No background' : 'Background'}</button>
                        {t.bg !== 'none' && <Color label="Fill" value={t.bg} onChange={v => patchSel({ bg: v } as Partial<TextEl>)} />}
                      </div>
                      <div className="flex gap-1.5">
                        <Num label="Radius" value={t.radius} onChange={v => patchSel({ radius: Math.max(0, v) } as Partial<TextEl>)} />
                        <Num label="Pad X" value={t.padX} onChange={v => patchSel({ padX: Math.max(0, v) } as Partial<TextEl>)} />
                        <Num label="Pad Y" value={t.padY} onChange={v => patchSel({ padY: Math.max(0, v) } as Partial<TextEl>)} />
                      </div>
                      <div className="flex gap-1.5">
                        <Num label="Line" value={t.lineHeight} step={0.05} onChange={v => patchSel({ lineHeight: Math.max(0.8, v) } as Partial<TextEl>)} />
                        <Num label="Spacing" value={t.letterSpacing} onChange={v => patchSel({ letterSpacing: v } as Partial<TextEl>)} />
                      </div>
                      {/* font family */}
                      <div className="space-y-1 pt-1.5 border-t border-slate-100">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Font</p>
                        <select value={t.fontFamily || FONT_OPTIONS[0].value} onChange={e => patchSel({ fontFamily: e.target.value } as Partial<TextEl>)}
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500">
                          {FONT_OPTIONS.map(f => <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>)}
                        </select>
                      </div>
                      {/* curve */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Curve</p>
                          <span className="text-[10px] font-black text-slate-500">{Math.round(t.curve || 0)}°</span>
                        </div>
                        <input type="range" min={-180} max={180} step={1} value={t.curve || 0} onChange={e => patchSel({ curve: Number(e.target.value) } as Partial<TextEl>)} className="w-full accent-indigo-600" />
                        {!!(t.curve && Math.abs(t.curve) > 0.5) && (
                          <button onClick={() => patchSel({ curve: 0 } as Partial<TextEl>)} className="text-[9px] font-bold text-indigo-500 hover:underline">Reset curve</button>
                        )}
                      </div>
                      {/* shadow */}
                      <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
                        <button onClick={() => patchSel({ shadow: !t.shadow } as Partial<TextEl>)} className={`px-2 py-1 rounded-lg text-[10px] font-black ${t.shadow ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{t.shadow ? 'Shadow on' : 'Shadow off'}</button>
                        {t.shadow && (
                          <>
                            <div className="flex items-center gap-2">
                              <Color label="Color" value={t.shadowColor || '#000000'} onChange={v => patchSel({ shadowColor: v } as Partial<TextEl>)} />
                              <Num label="Blur" value={t.shadowBlur ?? 6} onChange={v => patchSel({ shadowBlur: Math.max(0, v) } as Partial<TextEl>)} />
                            </div>
                            <div className="flex gap-1.5">
                              <Num label="Offset X" value={t.shadowX ?? 2} onChange={v => patchSel({ shadowX: v } as Partial<TextEl>)} />
                              <Num label="Offset Y" value={t.shadowY ?? 2} onChange={v => patchSel({ shadowY: v } as Partial<TextEl>)} />
                            </div>
                          </>
                        )}
                      </div>
                      {/* outline */}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Num label="Outline" value={t.strokeWidth ?? 0} step={0.5} onChange={v => patchSel({ strokeWidth: Math.max(0, v) } as Partial<TextEl>)} />
                          {!!(t.strokeWidth && t.strokeWidth > 0) && <Color label="Color" value={t.strokeColor || '#ffffff'} onChange={v => patchSel({ strokeColor: v } as Partial<TextEl>)} />}
                        </div>
                      </div>
                    </Section>
                  );
                })()}

                {sel.type === 'box' && (() => {
                  const b = sel as BoxEl;
                  return (
                    <Section title="Box">
                      <div className="flex items-center gap-2">
                        <button onClick={() => patchSel({ fill: b.fill === 'none' ? '#ef4444' : 'none' } as Partial<BoxEl>)} className={`px-2 py-1 rounded-lg text-[10px] font-black ${b.fill === 'none' ? 'bg-slate-100 text-slate-500' : 'bg-indigo-600 text-white'}`}>{b.fill === 'none' ? 'No fill' : 'Fill'}</button>
                        {b.fill !== 'none' && <Color label="Fill" value={b.fill} onChange={v => patchSel({ fill: v } as Partial<BoxEl>)} />}
                      </div>
                      <Num label="Radius" value={b.radius} onChange={v => patchSel({ radius: Math.max(0, v) } as Partial<BoxEl>)} />
                      <div className="flex gap-1.5 items-center">
                        <Num label="Border" value={b.borderWidth} onChange={v => patchSel({ borderWidth: Math.max(0, v) } as Partial<BoxEl>)} />
                        <Color label="Color" value={b.borderColor} onChange={v => patchSel({ borderColor: v } as Partial<BoxEl>)} />
                      </div>
                      <div className="pt-1 border-t border-slate-100 space-y-2">
                        <span className="block text-[9px] font-bold text-slate-400 uppercase">Text inside box</span>
                        <textarea value={b.text ?? ''} onChange={e => patchSel({ text: e.target.value } as Partial<BoxEl>)} rows={2} placeholder="Type text to show inside the box…"
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 resize-none" />
                        <div className="flex flex-wrap gap-1">
                          {STYLE_TOKENS.map(tok => (
                            <button key={tok.token} onClick={() => patchSel({ text: `${b.text ?? ''}${tok.token}` } as Partial<BoxEl>)} title={tok.label}
                              className="px-1.5 py-0.5 rounded bg-slate-100 text-[9px] font-bold text-slate-500 hover:bg-indigo-100 hover:text-indigo-700">{tok.label}</button>
                          ))}
                        </div>
                        <div className="flex gap-1.5 items-end">
                          <Num label="Size" value={b.fontSize ?? 32} onChange={v => patchSel({ fontSize: Math.max(6, v) } as Partial<BoxEl>)} />
                          <select value={b.fontWeight ?? 800} onChange={e => patchSel({ fontWeight: Number(e.target.value) } as Partial<BoxEl>)} className="flex-1 px-1.5 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none">
                            {[400, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <Color label="Text" value={b.textColor ?? '#ffffff'} onChange={v => patchSel({ textColor: v } as Partial<BoxEl>)} />
                          <div className="flex items-center gap-1 ml-auto">
                            {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
                              <button key={a} onClick={() => patchSel({ textAlign: a } as Partial<BoxEl>)} className={`p-1.5 rounded-lg ${(b.textAlign ?? 'center') === a ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon size={13} /></button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Section>
                  );
                })()}

                {sel.type === 'image' && (() => {
                  const im = sel as ImageEl;
                  const adj = (p: Partial<ImageEl>) => patchSel(p as Partial<ImageEl>);
                  return (
                    <>
                      {tool === 'erase' && eraserPanel}

                      {tool === 'crop' && (
                        <Section title="Crop">
                          <p className="text-[10px] text-slate-400 font-medium">Drag the box to position, drag the corner to resize, then apply.</p>
                          <div className="flex items-center gap-1.5">
                            <button onClick={applyCrop} disabled={busy} className="flex-1 px-2 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center gap-1">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Apply crop</button>
                            <button onClick={cancelCrop} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black">Cancel</button>
                          </div>
                        </Section>
                      )}

                      {tool === 'move' && (
                        <Section title="Image">
                          <div className="grid grid-cols-2 gap-1.5">
                            <button onClick={startErase} disabled={busy} className="px-2 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-[10px] font-black hover:bg-rose-100 disabled:opacity-40 flex items-center justify-center gap-1"><Eraser size={12} /> Eraser</button>
                            <button onClick={() => { startErase(); setEraseMode('fill'); }} disabled={busy} className="px-2 py-1.5 rounded-lg bg-fuchsia-50 text-fuchsia-700 text-[10px] font-black hover:bg-fuchsia-100 disabled:opacity-40 flex items-center justify-center gap-1"><Wand2 size={12} /> Magic erase</button>
                            <button onClick={startCrop} className="px-2 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black hover:bg-indigo-100 flex items-center justify-center gap-1"><Crop size={12} /> Crop</button>
                            <button onClick={() => adj({ flipH: !im.flipH })} className={`px-2 py-1.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 ${im.flipH ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}><FlipHorizontal size={12} /> Flip H</button>
                            <button onClick={() => adj({ flipV: !im.flipV })} className={`px-2 py-1.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 ${im.flipV ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}><FlipVertical size={12} /> Flip V</button>
                          </div>
                          <Num label="Radius" value={im.radius} onChange={v => adj({ radius: Math.max(0, v) })} />
                        </Section>
                      )}

                      {tool === 'move' && (
                        <Section title="Enhance">
                          <div className="grid grid-cols-2 gap-1.5">
                            <button onClick={() => enhanceImg('auto', 'el')} disabled={busy} className="px-2 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-[10px] font-black hover:bg-amber-100 disabled:opacity-40 flex items-center justify-center gap-1">{busy ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Auto-enhance</button>
                            <button onClick={() => enhanceImg('sharpen', 'el')} disabled={busy} className="px-2 py-1.5 rounded-lg bg-sky-50 text-sky-700 text-[10px] font-black hover:bg-sky-100 disabled:opacity-40 flex items-center justify-center gap-1"><Aperture size={12} /> Sharpen</button>
                          </div>
                        </Section>
                      )}

                      {tool === 'move' && (
                        <Section title="Touch-up">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wide flex items-center gap-1"><SlidersHorizontal size={11} /> Adjust</span>
                            <button onClick={() => adj({ brightness: 1, contrast: 1, saturate: 1, grayscale: false, hue: 0, sepia: 0, invert: false, blur: 0 })} className="text-[9px] font-black text-slate-400 hover:text-indigo-600 flex items-center gap-1"><RotateCcw size={10} /> Reset</button>
                          </div>
                          <label className="block">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Brightness {Math.round((im.brightness ?? 1) * 100)}%</span>
                            <input type="range" min={0.3} max={2} step={0.01} value={im.brightness ?? 1} onChange={e => adj({ brightness: Number(e.target.value) })} className="w-full accent-indigo-600" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Contrast {Math.round((im.contrast ?? 1) * 100)}%</span>
                            <input type="range" min={0.3} max={2} step={0.01} value={im.contrast ?? 1} onChange={e => adj({ contrast: Number(e.target.value) })} className="w-full accent-indigo-600" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Saturation {Math.round((im.saturate ?? 1) * 100)}%</span>
                            <input type="range" min={0} max={2} step={0.01} value={im.saturate ?? 1} onChange={e => adj({ saturate: Number(e.target.value) })} className="w-full accent-indigo-600" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Hue {Math.round(im.hue ?? 0)}°</span>
                            <input type="range" min={0} max={360} step={1} value={im.hue ?? 0} onChange={e => adj({ hue: Number(e.target.value) })} className="w-full accent-indigo-600" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Blur {(im.blur ?? 0).toFixed(1)}px</span>
                            <input type="range" min={0} max={8} step={0.1} value={im.blur ?? 0} onChange={e => adj({ blur: Number(e.target.value) })} className="w-full accent-indigo-600" />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Sepia {Math.round((im.sepia ?? 0) * 100)}%</span>
                            <input type="range" min={0} max={1} step={0.01} value={im.sepia ?? 0} onChange={e => adj({ sepia: Number(e.target.value) })} className="w-full accent-indigo-600" />
                          </label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button onClick={() => adj({ grayscale: !im.grayscale })} className={`px-2 py-1.5 rounded-lg text-[10px] font-black ${im.grayscale ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`}>{im.grayscale ? 'Grayscale on' : 'Grayscale'}</button>
                            <button onClick={() => adj({ invert: !im.invert })} className={`px-2 py-1.5 rounded-lg text-[10px] font-black ${im.invert ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`}>{im.invert ? 'Invert on' : 'Invert'}</button>
                          </div>
                        </Section>
                      )}

                      {tool === 'move' && (
                        <Section title="Background">
                          <label className="block text-[9px] font-bold text-slate-400 uppercase">Make white transparent · tol {tol}</label>
                          <input type="range" min={0} max={80} value={tol} onChange={e => setTol(Number(e.target.value))} className="w-full accent-indigo-600" />
                          <button onClick={removeWhite} disabled={busy} className="w-full px-2 py-1.5 rounded-lg bg-slate-700 text-white text-[10px] font-black hover:bg-slate-800 disabled:opacity-40 flex items-center justify-center gap-1">{busy ? <Loader2 size={12} className="animate-spin" /> : <Eraser size={12} />} Remove white background</button>
                        </Section>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
