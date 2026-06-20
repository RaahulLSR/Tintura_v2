
import React, { useState } from 'react';
import { ArrowLeft, Edit3, Printer, Palette, Ruler, Box, Calculator, Trash2, Maximize2 } from 'lucide-react';
import { Style, StyleTemplate, getStylePoster, getStyleCustomItems } from '../../types';
import { AttachmentGallery } from './AttachmentGallery';
import { AttachmentPreview } from './AttachmentPreview';

interface StyleFullViewProps {
  style: Style;
  template: StyleTemplate | null;
  onBack: () => void;
  onPrint: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const Consumption: React.FC<{ type?: string; val?: number; subtle?: boolean }> = ({ type, val, subtle }) => {
  if (!type) return null;
  const label = `${val} ${type === 'items_per_pc' ? 'Items / PC' : 'PCS / Item'}`;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${subtle ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-indigo-600 text-white'}`}>
      <Calculator size={10} /> {label}
    </span>
  );
};

export const StyleFullView: React.FC<StyleFullViewProps> = ({ style, template, onBack, onPrint, onEdit, onDelete }) => {
  const categories = template?.config.filter((c) => c.name !== 'General Info') || [];
  const poster = getStylePoster(style);
  const mainUrl = poster.mainUrl || poster.images[0]?.url;
  const customItems = getStyleCustomItems(style);
  const customNames = Object.keys(customItems);
  const colorCount = style.available_colors?.filter((c) => c).length || 0;
  const sizeCount = style.available_sizes?.length || 0;
  const [posterIdx, setPosterIdx] = useState<number | null>(null);
  const mainPosterIdx = Math.max(0, poster.images.findIndex((img) => img.url === mainUrl));

  return (
    <div className="bg-slate-100 min-h-screen animate-fade-in -m-8">
      {/* Toolbar */}
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 px-8 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all flex items-center gap-2 font-bold text-sm"><ArrowLeft size={18} /> Catalog</button>
          <div className="h-5 w-px bg-slate-200" />
          <div>
            <h1 className="text-lg font-black text-slate-900 tracking-tight leading-none">{style.style_number}</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{style.category} • {style.garment_type} ({style.demographic})</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onDelete} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" title="Delete Blueprint"><Trash2 size={18} /></button>
          <button onClick={onEdit} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg font-bold text-sm transition-all"><Edit3 size={16} /> Edit</button>
          <button onClick={onPrint} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg font-bold text-sm shadow-sm transition-all"><Printer size={16} /> Spec Sheet PDF</button>
        </div>
      </div>

      {/* Dense spec sheet */}
      <div className="max-w-5xl mx-auto p-5 print:p-0">
        <div className="bg-white rounded-lg border border-slate-300 shadow-sm overflow-hidden print:border-0 print:shadow-none">
          {/* Masthead */}
          <div className="flex items-stretch border-b-2 border-slate-900">
            <div className="bg-slate-900 text-white px-4 py-2.5 flex flex-col justify-center">
              <span className="text-sm font-black tracking-[0.15em] leading-none">TINTURA SST</span>
              <span className="text-[7px] font-bold tracking-[0.2em] text-slate-400 mt-1">FACTORY SPEC SHEET</span>
            </div>
            <div className="flex-1 flex items-center px-4 gap-3">
              <span className="text-2xl font-black text-indigo-700 tracking-tight">{style.style_number}</span>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{style.category} · {style.garment_type || '—'} · {style.demographic || '—'}</span>
            </div>
            <div className="px-4 py-2.5 border-l border-slate-200 text-right flex flex-col justify-center">
              <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest">Blueprint</span>
              <span className="font-mono text-xs font-bold text-slate-600">#{style.id.slice(0, 8)}</span>
            </div>
          </div>

          {/* Spec strip — dense, many columns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 border-b border-slate-300 [&>div]:border-r [&>div]:border-b [&>div]:border-slate-200 [&>div]:p-2">
            <div><div className="text-[7px] font-black text-slate-400 uppercase tracking-wider">Style No</div><div className="text-[11px] font-black text-slate-800 mt-0.5">{style.style_number}</div></div>
            <div><div className="text-[7px] font-black text-slate-400 uppercase tracking-wider">Category</div><div className="text-[11px] font-black text-slate-800 mt-0.5 truncate">{style.category}</div></div>
            <div><div className="text-[7px] font-black text-slate-400 uppercase tracking-wider">Garment</div><div className="text-[11px] font-black text-slate-800 mt-0.5 truncate">{style.garment_type || 'N/A'}</div></div>
            <div><div className="text-[7px] font-black text-slate-400 uppercase tracking-wider">Segment</div><div className="text-[11px] font-black text-slate-800 mt-0.5 truncate">{style.demographic || 'N/A'}</div></div>
            <div><div className="text-[7px] font-black text-slate-400 uppercase tracking-wider">Packing</div><div className="text-[11px] font-black text-slate-800 mt-0.5 capitalize truncate">{style.packing_type || '—'}</div></div>
            <div><div className="text-[7px] font-black text-slate-400 uppercase tracking-wider">Pcs / Box</div><div className="text-[11px] font-black text-slate-800 mt-0.5">{style.pcs_per_box}</div></div>
            <div><div className="text-[7px] font-black text-slate-400 uppercase tracking-wider">Size Type</div><div className="text-[11px] font-black text-slate-800 mt-0.5">{style.size_type || '—'}</div></div>
            <div><div className="text-[7px] font-black text-slate-400 uppercase tracking-wider">Colors / Sizes</div><div className="text-[11px] font-black text-slate-800 mt-0.5">{colorCount} / {sizeCount}</div></div>
          </div>

          {/* Poster + palette */}
          <div className={`grid ${mainUrl ? 'md:grid-cols-[200px_1fr]' : 'grid-cols-1'} gap-3 p-3 border-b border-slate-300`}>
            {mainUrl && (
              <button type="button" onClick={() => setPosterIdx(mainPosterIdx)} title="Click to expand" className="group/poster border border-slate-200 rounded bg-slate-50 flex items-center justify-center max-h-48 overflow-hidden relative print:cursor-default">
                <img src={mainUrl} alt={style.style_number} className="max-w-full max-h-48 w-auto h-auto object-contain" />
                <span className="absolute inset-0 bg-slate-900/0 group-hover/poster:bg-slate-900/30 flex items-center justify-center text-white opacity-0 group-hover/poster:opacity-100 transition-all print:hidden"><Maximize2 size={20} /></span>
              </button>
            )}
            <div className="grid gap-2 content-start">
              <div className="border border-slate-200 rounded p-2 bg-slate-50/60">
                <div className="text-[7px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1.5"><Palette size={10} /> Approved Palette</div>
                <div className="flex flex-wrap gap-1">
                  {style.available_colors?.filter((c) => c).map((c, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-white border border-slate-300 text-[9px] font-bold rounded-full text-slate-700 uppercase">{c}</span>
                  )) || <span className="text-[10px] text-slate-300 italic">None</span>}
                </div>
              </div>
              <div className="border border-slate-200 rounded p-2 bg-slate-50/60">
                <div className="text-[7px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1.5"><Ruler size={10} /> Size Grid ({style.size_type})</div>
                <div className="flex flex-wrap gap-1">
                  {style.available_sizes?.map((s, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-indigo-700 text-white text-[9px] font-bold rounded-full">{s}</span>
                  )) || <span className="text-[10px] text-slate-300 italic">None</span>}
                </div>
              </div>
              {poster.images.length > 1 && (
                <div className="flex gap-1.5 flex-wrap">
                  {poster.images.map((img, i) => (
                    <button key={i} type="button" onClick={() => setPosterIdx(i)} title="Click to expand" className={`w-11 h-11 rounded overflow-hidden border bg-slate-50 flex items-center justify-center hover:ring-2 hover:ring-indigo-400 transition-all ${img.url === mainUrl ? 'border-indigo-500 ring-1 ring-indigo-500/30' : 'border-slate-200'}`}>
                      <img src={img.url} alt={img.name} className="w-full h-full object-contain" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Construction summary */}
          <div className="px-3 py-2 border-b border-slate-300 bg-slate-50/60 border-l-4 border-l-indigo-600">
            <span className="text-[7px] font-black text-slate-400 uppercase tracking-wider">Construction Summary</span>
            <p className="text-[11px] font-medium text-slate-700 leading-snug whitespace-pre-wrap mt-0.5">{style.style_text || <span className="text-slate-300 italic">Standard technical construction procedures apply.</span>}</p>
          </div>

          {/* Dense tech-pack tables */}
          <div className="p-3 space-y-3">
            {categories.map((cat) => {
              const fields = cat.fields.filter((f) => {
                const d = style.tech_pack[cat.name]?.[f];
                return d && (d.text || d.attachments?.length || d.variants?.length);
              });
              if (fields.length === 0) return null;
              return (
                <div key={cat.name} className="border border-slate-300 rounded overflow-hidden break-inside-avoid">
                  <div className="bg-slate-900 text-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider">{cat.name}</div>
                  <div className="divide-y divide-slate-200">
                    {fields.map((field) => {
                      const data = style.tech_pack[cat.name]?.[field] || { text: '', attachments: [] };
                      const isSplit = !!data.variants?.length;
                      return (
                        <div key={field} className="grid grid-cols-1 md:grid-cols-[120px_1fr]">
                          <div className="bg-slate-100 border-r border-slate-200 px-3 py-2 flex items-start justify-between md:block gap-2">
                            <h3 className="font-black text-slate-600 text-[9px] uppercase tracking-tight">{field}</h3>
                            {!isSplit && data.consumption_type && <div className="mt-1"><Consumption type={data.consumption_type} val={data.consumption_val} subtle /></div>}
                            {isSplit && <span className="md:mt-1 inline-block text-[8px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded uppercase tracking-wide">Variants</span>}
                          </div>

                          <div className="px-3 py-2">
                            {!isSplit ? (
                              <div className="space-y-2">
                                <p className="text-slate-800 text-[11px] font-medium leading-snug whitespace-pre-wrap">{data.text || <span className="text-slate-300 italic">—</span>}</p>
                                {data.attachments.length > 0 && <AttachmentGallery attachments={data.attachments} />}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {data.variants?.map((v, idx) => (
                                  <div key={idx} className="border border-slate-200 rounded p-2 space-y-1.5 bg-slate-50/60 break-inside-avoid">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                      <div className="flex flex-wrap gap-1">
                                        {v.colors.length > 0 ? v.colors.map((c) => (
                                          <span key={c} className="bg-indigo-700 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase">{c}</span>
                                        )) : <span className="text-[9px] font-bold text-slate-400 italic bg-white px-1.5 py-0.5 rounded-full border">Shared</span>}
                                      </div>
                                      {!v.sizeVariants && <Consumption type={v.consumption_type} val={v.consumption_val} subtle />}
                                    </div>
                                    {!v.sizeVariants ? (
                                      <div className="space-y-1.5">
                                        <p className="text-slate-800 text-[11px] font-medium whitespace-pre-wrap leading-snug">{v.text || <span className="text-slate-300 italic">—</span>}</p>
                                        {v.attachments.length > 0 && <AttachmentGallery attachments={v.attachments} />}
                                      </div>
                                    ) : (
                                      <div className="space-y-1.5 pt-1.5 border-t border-dashed border-slate-300">
                                        {v.sizeVariants.map((sv, sIdx) => (
                                          <div key={sIdx} className="bg-white p-2 rounded border border-slate-200 space-y-1">
                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                              <div className="flex flex-wrap gap-1">
                                                {sv.sizes.length > 0 ? sv.sizes.map((sz) => (
                                                  <span key={sz} className="bg-blue-600 text-white px-1.5 py-0.5 rounded font-black text-[9px]">{sz}</span>
                                                )) : <span className="text-[10px] text-slate-300 italic">No sizes</span>}
                                              </div>
                                              <Consumption type={sv.consumption_type} val={sv.consumption_val} subtle />
                                            </div>
                                            <p className="text-slate-800 text-[11px] font-medium leading-snug whitespace-pre-wrap">{sv.text || <span className="text-slate-300 italic">—</span>}</p>
                                            {sv.attachments.length > 0 && <AttachmentGallery attachments={sv.attachments} />}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Custom / extra items */}
            {customNames.length > 0 && (
              <div className="border border-slate-300 rounded overflow-hidden break-inside-avoid">
                <div className="bg-slate-900 text-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider">Additional Specifications</div>
                <div className="divide-y divide-slate-200">
                  {customNames.map((name) => {
                    const data = customItems[name];
                    return (
                      <div key={name} className="grid grid-cols-1 md:grid-cols-[120px_1fr]">
                        <div className="bg-slate-100 border-r border-slate-200 px-3 py-2">
                          <h3 className="font-black text-slate-600 text-[9px] uppercase tracking-tight">{name}</h3>
                        </div>
                        <div className="px-3 py-2 space-y-2">
                          <p className="text-slate-800 text-[11px] font-medium leading-snug whitespace-pre-wrap">{data.text || <span className="text-slate-300 italic">—</span>}</p>
                          {(data.attachments?.length || 0) > 0 && <AttachmentGallery attachments={data.attachments} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-slate-300 flex justify-between items-center">
            <span className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">Tintura SST · Factory Spec Sheet</span>
            <span className="text-[8px] text-slate-300 font-mono">ID {style.id.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      {posterIdx !== null && poster.images.length > 0 && (
        <AttachmentPreview attachments={poster.images} startIndex={posterIdx} onClose={() => setPosterIdx(null)} />
      )}
    </div>
  );
};
