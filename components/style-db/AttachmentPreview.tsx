import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Printer, ChevronLeft, ChevronRight, FileText, Loader2, ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import { Attachment } from '../../types';

type Kind = 'image' | 'pdf' | 'excel' | 'csv' | 'other';

const extOf = (a: Attachment): string => {
  const src = (a.name || a.url || '').split('?')[0];
  const m = src.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
};

const kindOf = (a: Attachment): Kind => {
  if (a.type === 'image') return 'image';
  const ext = extOf(a);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls') return 'excel';
  if (ext === 'csv') return 'csv';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  return 'other';
};

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else { cell += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (ch === '\r') {
      // ignore
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
};

const CsvTable: React.FC<{ url: string }> = ({ url }) => {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then(r => r.text())
      .then(t => { if (alive) setRows(parseCsv(t)); })
      .catch(() => { if (alive) setErr('Could not load the file.'); });
    return () => { alive = false; };
  }, [url]);
  if (err) return <div className="p-8 text-center text-sm text-slate-500">{err}</div>;
  if (!rows) return <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-indigo-500" /></div>;
  const [head, ...body] = rows;
  return (
    <div className="overflow-auto max-h-full">
      <table className="min-w-full text-xs border-collapse">
        <thead className="sticky top-0">
          <tr>
            {head?.map((h, i) => (
              <th key={i} className="bg-slate-800 text-white font-black px-3 py-2 text-left border border-slate-700 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className={ri % 2 ? 'bg-slate-50' : 'bg-white'}>
              {head?.map((_, ci) => (
                <td key={ci} className="px-3 py-1.5 border border-slate-200 text-slate-700 whitespace-nowrap">{r[ci] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const AttachmentPreview: React.FC<{ attachments: Attachment[]; startIndex?: number; onClose: () => void }> = ({ attachments, startIndex = 0, onClose }) => {
  const [idx, setIdx] = useState(Math.max(0, Math.min(startIndex, attachments.length - 1)));
  const [fitWidth, setFitWidth] = useState(false);
  const att = attachments[idx];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIdx(i => Math.min(i + 1, attachments.length - 1));
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attachments.length, onClose]);

  // Reset zoom mode when switching files.
  useEffect(() => { setFitWidth(false); }, [idx]);

  if (!att) return null;
  const kind = kindOf(att);

  const printIt = () => {
    if (kind === 'image') {
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(`<html><head><title>${att.name}</title><style>@media print{@page{margin:12mm}}body{margin:0;display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100vh}</style></head><body><img src="${att.url}" onload="setTimeout(()=>window.print(),300)"/></body></html>`);
      w.document.close();
    } else {
      window.open(att.url, '_blank');
    }
  };

  const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(att.url)}`;

  // Rendered through a portal to document.body so the overlay always covers the
  // whole viewport (escapes the sidebar's stacking context / page transforms).
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-sm flex flex-col" onClick={onClose}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 bg-slate-900 text-white shrink-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 min-w-0">
          <FileText size={16} className="text-indigo-300 shrink-0" />
          <span className="text-sm font-bold truncate">{att.name}</span>
          {attachments.length > 1 && <span className="text-[11px] text-slate-400 font-bold shrink-0">{idx + 1} / {attachments.length}</span>}
        </div>
        <div className="flex items-center gap-1">
          {kind === 'image' && (
            <button onClick={() => setFitWidth(f => !f)} className="p-2 rounded-lg hover:bg-white/10 transition-colors" title={fitWidth ? 'Fit to screen' : 'Fit to width'}>
              {fitWidth ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          )}
          <button onClick={printIt} className="p-2 rounded-lg hover:bg-white/10 transition-colors" title="Print"><Printer size={18} /></button>
          <a href={att.url} download={att.name} target="_blank" rel="noreferrer" className="p-2 rounded-lg hover:bg-white/10 transition-colors" title="Download"><Download size={18} /></a>
          <a href={att.url} target="_blank" rel="noreferrer" className="p-2 rounded-lg hover:bg-white/10 transition-colors" title="Open in new tab"><ExternalLink size={18} /></a>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors" title="Close"><X size={20} /></button>
        </div>
      </div>

      {/* Body */}
      <div className={`flex-1 relative p-4 ${kind === 'image' && fitWidth ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden'}`} onClick={e => e.stopPropagation()}>
        {attachments.length > 1 && (
          <>
            <button onClick={() => setIdx(i => Math.max(i - 1, 0))} disabled={idx === 0} className="fixed left-3 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 transition-all"><ChevronLeft size={24} /></button>
            <button onClick={() => setIdx(i => Math.min(i + 1, attachments.length - 1))} disabled={idx === attachments.length - 1} className="fixed right-3 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 transition-all"><ChevronRight size={24} /></button>
          </>
        )}

        {kind === 'image' && (
          fitWidth ? (
            <div className="w-full flex justify-center">
              <img src={att.url} alt={att.name} className="w-full max-w-5xl h-auto rounded-lg shadow-2xl" />
            </div>
          ) : (
            <img src={att.url} alt={att.name} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
          )
        )}
        {kind === 'pdf' && (
          <iframe src={att.url} title={att.name} className="w-full h-full bg-white rounded-lg shadow-2xl" />
        )}
        {kind === 'excel' && (
          <iframe src={officeUrl} title={att.name} className="w-full h-full bg-white rounded-lg shadow-2xl" />
        )}
        {kind === 'csv' && (
          <div className="w-full h-full bg-white rounded-lg shadow-2xl overflow-auto"><CsvTable url={att.url} /></div>
        )}
        {kind === 'other' && (
          <div className="bg-white rounded-2xl p-10 text-center max-w-md">
            <FileText size={48} className="text-slate-300 mx-auto mb-4" />
            <p className="font-black text-slate-700 mb-1">No inline preview</p>
            <p className="text-sm text-slate-500 mb-5">This file type can’t be previewed here.</p>
            <a href={att.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm"><Download size={16} /> Download</a>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
