import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Copy, Plus, Save, Loader2, Tag, Palette, Ruler, Layers, Box,
  CheckCircle2, Trash2, AlertTriangle, ChevronRight, ChevronLeft, DollarSign, Lock,
  Image as ImageIcon, Star, Upload
} from 'lucide-react';
import { Style, StyleTemplate, Attachment, getStylePoster, getStyleCustomItems, POSTER_KEY, CUSTOM_KEY } from '../../types';
import { CategoryEditor } from './CategoryEditor';
import { validateStyle, countFilledFields } from './styleValidation';

interface StyleEditorProps {
  isEditing: Style;
  styles: Style[];
  template: StyleTemplate | null;
  setIsEditing: (style: Style | null) => void;
  handleSaveStyle: (e: React.FormEvent) => void;
  handleCopyStyle: (sourceStyle: Style) => void;
  handleFileUpload: (category: string, field: string, files: FileList | null, variantIndex?: number, sizeIndex?: number) => void;
  handlePosterUpload: (files: FileList | null) => void;
  editTarget: { category?: string, field?: string } | null;
  garmentTypeOptions: string[];
  setGarmentTypeOptions: (opts: string[]) => void;
  demographicOptions: string[];
  setDemographicOptions: (opts: string[]) => void;
  isUploading: boolean;
}

type TabId = 'identity' | 'posters' | 'colours' | 'tech' | 'packing' | 'costing' | 'review';

const TABS: { id: TabId; label: string; icon: React.ElementType; disabled?: boolean }[] = [
  { id: 'identity', label: 'Identity', icon: Tag },
  { id: 'posters', label: 'Posters', icon: ImageIcon },
  { id: 'colours', label: 'Colours & Sizes', icon: Palette },
  { id: 'tech', label: 'Tech Pack', icon: Layers },
  { id: 'packing', label: 'Packing', icon: Box },
  { id: 'costing', label: 'Costing', icon: DollarSign, disabled: true },
  { id: 'review', label: 'Review', icon: CheckCircle2 },
];

export const StyleEditor: React.FC<StyleEditorProps> = ({
  isEditing,
  styles,
  template,
  setIsEditing,
  handleSaveStyle,
  handleCopyStyle,
  handleFileUpload,
  handlePosterUpload,
  editTarget,
  garmentTypeOptions,
  setGarmentTypeOptions,
  demographicOptions,
  setDemographicOptions,
  isUploading,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>(editTarget?.category ? 'tech' : 'identity');

  useEffect(() => {
    if (editTarget?.category) setActiveTab('tech');
  }, [editTarget]);

  const issues = useMemo(() => validateStyle(isEditing), [isEditing]);
  const errors = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warn');
  const completeness = useMemo(() => countFilledFields(isEditing), [isEditing]);

  const techCategories = (template?.config || []).filter(c => c.name !== 'General Info' && c.fields && c.fields.length > 0);

  const set = (patch: Partial<Style>) => setIsEditing({ ...isEditing, ...patch });

  const activeOrder = TABS.filter(t => !t.disabled).map(t => t.id);
  const idx = activeOrder.indexOf(activeTab);
  const goPrev = () => idx > 0 && setActiveTab(activeOrder[idx - 1]);
  const goNext = () => idx < activeOrder.length - 1 && setActiveTab(activeOrder[idx + 1]);

  const inputBase = 'w-full border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm transition-all';
  const labelBase = 'block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1';

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[95vh] overflow-hidden flex flex-col animate-scale-up border border-slate-200">

        {/* Header */}
        <div className="px-8 py-6 border-b bg-slate-50 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-2xl font-black text-slate-800 tracking-tight">
              {isEditing.id ? `Editing ${isEditing.style_number || 'Style'}` : 'New Style Blueprint'}
            </h3>
            <p className="text-slate-500 text-[11px] font-bold uppercase tracking-widest mt-1">
              {completeness.total > 0
                ? `${completeness.filled}/${completeness.total} fields filled · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
                : 'Guided tech-pack builder'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!isEditing.id && (
              <button
                type="button"
                onClick={() => {
                  const source = prompt('Enter Style Number to copy from:');
                  if (source) {
                    const match = styles.find(s => s.style_number.toLowerCase() === source.toLowerCase());
                    if (match) handleCopyStyle(match);
                    else alert('Style not found.');
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-black border border-indigo-100 hover:bg-indigo-100"
              >
                <Copy size={14} /> Copy Existing
              </button>
            )}
            <button onClick={() => setIsEditing(null)} className="text-slate-300 hover:text-slate-600 transition-colors p-2 hover:bg-slate-100 rounded-full"><X size={28} /></button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-6 pt-4 bg-white border-b border-slate-100 flex gap-1 overflow-x-auto shrink-0">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const tabErrors = tab.id === 'identity' && errors.length > 0;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={tab.disabled}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-5 py-3 rounded-t-xl text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all border-b-2 ${
                  tab.disabled
                    ? 'text-slate-300 cursor-not-allowed border-transparent'
                    : isActive
                      ? 'text-indigo-600 border-indigo-600 bg-indigo-50/50'
                      : 'text-slate-400 border-transparent hover:text-slate-600'
                }`}
              >
                <Icon size={15} />
                {tab.label}
                {tab.disabled && <Lock size={11} className="opacity-60" />}
                {tabErrors && <span className="w-2 h-2 rounded-full bg-red-500" />}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <form onSubmit={handleSaveStyle} className="flex-1 overflow-y-auto p-8 bg-slate-50/30">

          {/* IDENTITY */}
          {activeTab === 'identity' && (
            <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
              <div>
                <label className={labelBase}>Style Number *</label>
                <input required className={inputBase} value={isEditing.style_number} onChange={e => set({ style_number: e.target.value })} placeholder="e.g. TS-1042" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={labelBase}>Garment Type</label>
                  <div className="flex gap-2">
                    <select className={`${inputBase} cursor-pointer`} value={isEditing.garment_type} onChange={e => set({ garment_type: e.target.value })}>
                      {garmentTypeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                    <button type="button" onClick={() => { const v = prompt('New Garment Type:'); if (v) setGarmentTypeOptions([...garmentTypeOptions, v]); }} className="p-4 bg-white border-2 border-slate-100 rounded-xl text-indigo-600"><Plus size={18} /></button>
                  </div>
                </div>
                <div>
                  <label className={labelBase}>Demographic</label>
                  <div className="flex gap-2">
                    <select className={`${inputBase} cursor-pointer`} value={isEditing.demographic} onChange={e => set({ demographic: e.target.value })}>
                      {demographicOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                    <button type="button" onClick={() => { const v = prompt('New Demographic:'); if (v) setDemographicOptions([...demographicOptions, v]); }} className="p-4 bg-white border-2 border-slate-100 rounded-xl text-indigo-600"><Plus size={18} /></button>
                  </div>
                </div>
                <div>
                  <label className={labelBase}>Category</label>
                  <select className={`${inputBase} cursor-pointer`} value={isEditing.category} onChange={e => set({ category: e.target.value })}>
                    <option value="Casuals">Casuals</option>
                    <option value="Lite">Lite</option>
                    <option value="Sportz">Sportz</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelBase}>Short Description / Construction Summary</label>
                <textarea className={`${inputBase} min-h-[120px] font-medium`} value={isEditing.style_text} onChange={e => set({ style_text: e.target.value })} placeholder="A short description shown on cards and the tech-pack header..." />
              </div>
            </div>
          )}

          {/* POSTERS */}
          {activeTab === 'posters' && (
            <PosterEditor isEditing={isEditing} setIsEditing={setIsEditing} handlePosterUpload={handlePosterUpload} isUploading={isUploading} />
          )}

          {/* COLOURS & SIZES */}
          {activeTab === 'colours' && (
            <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in">
              {/* Colours */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 flex flex-col">
                <div className="flex items-center gap-2 mb-5"><Palette size={18} className="text-indigo-600" /><h4 className="font-black text-slate-700 text-xs uppercase tracking-widest">Approved Palette</h4></div>
                <div className="space-y-2 flex-1 overflow-y-auto pr-1">
                  {(isEditing.available_colors || ['']).map((color, i) => (
                    <div key={i} className="flex gap-2">
                      <input className="flex-1 border-2 border-slate-200 rounded-xl p-3 bg-white text-slate-900 font-bold focus:border-indigo-500 outline-none text-sm" placeholder="Type colour..." value={color} onChange={e => { const next = [...(isEditing.available_colors || [])]; next[i] = e.target.value; set({ available_colors: next }); }} />
                      <button type="button" onClick={() => { const next = (isEditing.available_colors || []).filter((_, j) => j !== i); set({ available_colors: next.length ? next : [''] }); }} className="p-3 text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => set({ available_colors: [...(isEditing.available_colors || []), ''] })} className="w-full mt-4 py-2.5 border-2 border-dashed border-indigo-200 text-indigo-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-indigo-50 flex items-center justify-center gap-2"><Plus size={14} /> Add Colour</button>
              </div>

              {/* Sizes */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 flex flex-col">
                <div className="flex justify-between items-center mb-5">
                  <div className="flex items-center gap-2"><Ruler size={18} className="text-indigo-600" /><h4 className="font-black text-slate-700 text-xs uppercase tracking-widest">Size Grid</h4></div>
                  <div className="flex bg-slate-200 p-1 rounded-lg">
                    <button type="button" onClick={() => set({ size_type: 'letter', available_sizes: ['S', 'M', 'L', 'XL', 'XXL', '3XL'] })} className={`px-3 py-1 rounded-md text-[9px] font-black uppercase ${isEditing.size_type === 'letter' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>ABC</button>
                    <button type="button" onClick={() => set({ size_type: 'number', available_sizes: ['65', '70', '75', '80', '85', '90'] })} className={`px-3 py-1 rounded-md text-[9px] font-black uppercase ${isEditing.size_type === 'number' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>123</button>
                  </div>
                </div>
                <div className="flex-1 flex flex-wrap content-start gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 min-h-[120px]">
                  {(isEditing.available_sizes || []).map((sz, i) => (
                    <div key={i} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-2 shadow-sm">
                      {sz}
                      <button type="button" onClick={() => set({ available_sizes: (isEditing.available_sizes || []).filter((_, j) => j !== i) })} className="text-white/50 hover:text-white"><X size={12} /></button>
                    </div>
                  ))}
                  {(isEditing.available_sizes || []).length === 0 && <span className="text-[11px] text-slate-300 italic px-2 py-1">No sizes yet</span>}
                </div>
                <button type="button" onClick={() => { const v = prompt('Enter new size:'); if (v) set({ available_sizes: [...(isEditing.available_sizes || []), v] }); }} className="w-full mt-4 py-2.5 border-2 border-dashed border-indigo-200 text-indigo-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-indigo-50 flex items-center justify-center gap-2"><Plus size={14} /> Add Custom Size</button>
              </div>
            </div>
          )}

          {/* TECH PACK */}
          {activeTab === 'tech' && (
            <div className="animate-fade-in">
              {techCategories.length === 0 ? (
                <div className="text-center py-20 text-slate-400"><Layers size={40} className="mx-auto mb-4 opacity-20" /><p className="font-bold">No tech-pack categories configured.</p></div>
              ) : (
                techCategories.map(cat => (
                  <CategoryEditor
                    key={cat.name}
                    category={cat}
                    isEditing={isEditing}
                    setIsEditing={setIsEditing}
                    handleFileUpload={handleFileUpload}
                    targetFocus={editTarget}
                    mode="fields"
                  />
                ))
              )}
              <CustomItemsEditor isEditing={isEditing} setIsEditing={setIsEditing} handleFileUpload={handleFileUpload} isUploading={isUploading} />
            </div>
          )}

          {/* PACKING */}
          {activeTab === 'packing' && (
            <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-slate-100 shadow-sm p-8 grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
              <div>
                <label className={labelBase}>Type of Packing</label>
                <select className={`${inputBase} cursor-pointer`} value={isEditing.packing_type} onChange={e => set({ packing_type: e.target.value })}>
                  <option value="pouch">Pouch</option>
                  <option value="cover">Cover</option>
                  <option value="box">Box</option>
                </select>
              </div>
              <div>
                <label className={labelBase}>Pieces per Box</label>
                <input type="number" className={inputBase} value={isEditing.pcs_per_box} onChange={e => set({ pcs_per_box: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
          )}

          {/* REVIEW */}
          {activeTab === 'review' && (
            <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryStat label="Colours" value={(isEditing.available_colors || []).filter(c => c.trim()).length} />
                <SummaryStat label="Sizes" value={(isEditing.available_sizes || []).filter(s => s.trim()).length} />
                <SummaryStat label="Fields filled" value={`${completeness.filled}/${completeness.total}`} />
                <SummaryStat label="Warnings" value={warnings.length} tone={warnings.length ? 'warn' : 'ok'} />
              </div>

              {errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
                  <div className="flex items-center gap-2 text-red-700 font-black text-xs uppercase tracking-widest mb-3"><AlertTriangle size={16} /> Must fix before saving</div>
                  <ul className="space-y-1.5">{errors.map((e, i) => <li key={i} className="text-sm font-medium text-red-700">• {e.message}</li>)}</ul>
                </div>
              )}

              {warnings.length > 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                  <div className="flex items-center gap-2 text-amber-700 font-black text-xs uppercase tracking-widest mb-3"><AlertTriangle size={16} /> Review ({warnings.length})</div>
                  <ul className="space-y-1.5 max-h-64 overflow-y-auto">{warnings.map((w, i) => <li key={i} className="text-sm font-medium text-amber-800">• {w.message}</li>)}</ul>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-6 flex items-center gap-3 text-green-700">
                  <CheckCircle2 size={22} /><span className="font-bold">No data-quality warnings. This blueprint is clean.</span>
                </div>
              )}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-8 py-5 border-t bg-white flex justify-between items-center shadow-2xl shrink-0">
          <div className="flex items-center gap-2">
            <button type="button" onClick={goPrev} disabled={idx === 0} className="px-4 py-3 rounded-xl font-black text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30 flex items-center gap-1.5"><ChevronLeft size={16} /> Back</button>
            <button type="button" onClick={goNext} disabled={idx === activeOrder.length - 1} className="px-4 py-3 rounded-xl font-black text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30 flex items-center gap-1.5">Next <ChevronRight size={16} /></button>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setIsEditing(null)} className="px-8 py-4 font-black text-slate-400 hover:text-slate-600 uppercase text-xs">Cancel</button>
            <button onClick={handleSaveStyle} disabled={isUploading || errors.length > 0} className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-2xl shadow-indigo-200 flex items-center gap-3 active:scale-95 disabled:opacity-50 uppercase text-xs">
              {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Commit Style
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SummaryStat: React.FC<{ label: string; value: React.ReactNode; tone?: 'ok' | 'warn' }> = ({ label, value, tone }) => (
  <div className={`rounded-2xl border p-4 ${tone === 'warn' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'}`}>
    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</div>
    <div className={`text-2xl font-black mt-1 ${tone === 'warn' ? 'text-amber-600' : 'text-slate-800'}`}>{value}</div>
  </div>
);

const PosterEditor: React.FC<{
  isEditing: Style;
  setIsEditing: (s: Style | null) => void;
  handlePosterUpload: (files: FileList | null) => void;
  isUploading: boolean;
}> = ({ isEditing, setIsEditing, handlePosterUpload, isUploading }) => {
  const poster = getStylePoster(isEditing);
  const mainUrl = poster.mainUrl || poster.images[0]?.url;

  const update = (images: Attachment[], main?: string) => {
    const tp: any = { ...(isEditing.tech_pack || {}) };
    if (images.length === 0) delete tp[POSTER_KEY];
    else tp[POSTER_KEY] = { images, mainUrl: main };
    setIsEditing({ ...isEditing, tech_pack: tp });
  };
  const setMain = (url: string) => update(poster.images, url);
  const remove = (url: string) => {
    const images = poster.images.filter(i => i.url !== url);
    update(images, poster.mainUrl === url ? images[0]?.url : poster.mainUrl);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2"><ImageIcon size={18} className="text-indigo-600" /><h4 className="font-black text-slate-700 text-xs uppercase tracking-widest">Poster / Digital Assets</h4></div>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition-all">
              {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload images
              <input type="file" accept="image/*" multiple className="hidden" onChange={e => { handlePosterUpload(e.target.files); e.currentTarget.value = ''; }} />
            </label>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 font-medium mb-5">Upload one or more photos. Click the star to choose the <span className="font-black text-indigo-500">main image</span> used as the style's profile picture on cards, the tech-pack cover and order screens.</p>

        {poster.images.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl py-14 text-center text-slate-300">
            <ImageIcon size={40} className="mx-auto mb-3 opacity-40" />
            <p className="font-bold text-sm text-slate-400">No poster images yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {poster.images.map((img, i) => {
              const isMain = img.url === mainUrl;
              return (
                <div key={i} className={`relative group rounded-2xl overflow-hidden border-2 bg-slate-50 ${isMain ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200'}`}>
                  <div className="aspect-[4/3] flex items-center justify-center">
                    <img src={img.url} alt={img.name} className="w-full h-full object-contain" />
                  </div>
                  {isMain && <div className="absolute top-2 left-2 bg-indigo-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1"><Star size={10} className="fill-current" /> Main</div>}
                  <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    {!isMain && <button type="button" onClick={() => setMain(img.url)} className="px-3 py-1.5 bg-white text-indigo-600 rounded-lg text-[10px] font-black flex items-center gap-1"><Star size={12} /> Set main</button>}
                    <button type="button" onClick={() => remove(img.url)} className="p-1.5 bg-red-600 text-white rounded-lg"><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const CustomItemsEditor: React.FC<{
  isEditing: Style;
  setIsEditing: (s: Style | null) => void;
  handleFileUpload: (category: string, field: string, files: FileList | null) => void;
  isUploading: boolean;
}> = ({ isEditing, setIsEditing, handleFileUpload, isUploading }) => {
  const items = getStyleCustomItems(isEditing);
  const names = Object.keys(items);

  const writeItems = (next: Record<string, any>) => {
    const tp: any = { ...(isEditing.tech_pack || {}) };
    if (Object.keys(next).length === 0) delete tp[CUSTOM_KEY];
    else tp[CUSTOM_KEY] = next;
    setIsEditing({ ...isEditing, tech_pack: tp });
  };
  const addField = () => {
    const name = prompt('Name of the extra item (e.g. "Special Wash", "Hangtag", "Embroidery"):')?.trim();
    if (!name) return;
    if (items[name]) { alert('An item with that name already exists.'); return; }
    writeItems({ ...items, [name]: { text: '', attachments: [] } });
  };
  const removeField = (name: string) => {
    const next = { ...items };
    delete next[name];
    writeItems(next);
  };
  const setText = (name: string, text: string) => {
    writeItems({ ...items, [name]: { ...items[name], text } });
  };
  const removeAttachment = (name: string, url: string) => {
    writeItems({ ...items, [name]: { ...items[name], attachments: (items[name].attachments || []).filter((a: Attachment) => a.url !== url) } });
  };

  return (
    <div className="mt-8 bg-white rounded-3xl border border-dashed border-indigo-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2"><Plus size={18} className="text-indigo-600" /><h4 className="font-black text-slate-700 text-xs uppercase tracking-widest">Custom / Extra Items</h4></div>
        <button type="button" onClick={addField} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl text-xs font-black hover:bg-indigo-100"><Plus size={14} /> Add item</button>
      </div>
      <p className="text-[11px] text-slate-400 font-medium mb-5">Anything beyond the standard template that this particular style needs.</p>

      {names.length === 0 ? (
        <div className="text-center py-8 text-slate-300 text-sm font-bold">No custom items.</div>
      ) : (
        <div className="space-y-4">
          {names.map(name => {
            const item = items[name];
            return (
              <div key={name} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="font-black text-slate-800 text-sm uppercase tracking-tight">{name}</h5>
                  <button type="button" onClick={() => removeField(name)} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                </div>
                <textarea className="w-full border-2 border-slate-100 rounded-xl p-3 bg-white text-slate-900 font-medium text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-h-[70px]" placeholder="Instructions / notes..." value={item.text || ''} onChange={e => setText(name, e.target.value)} />
                <div className="flex flex-wrap gap-2 mt-3">
                  {(item.attachments || []).map((a: Attachment, ai: number) => (
                    <div key={ai} className="group/att relative w-16 h-16 rounded-xl border border-slate-200 bg-white flex items-center justify-center shadow-sm overflow-hidden">
                      {a.type === 'image' ? <img src={a.url} className="w-full h-full object-contain" /> : <span className="text-[8px] font-bold text-slate-500 text-center px-1 truncate">{a.name}</span>}
                      <button type="button" onClick={() => removeAttachment(name, a.url)} className="absolute inset-0 bg-red-600/80 text-white opacity-0 group-hover/att:opacity-100 flex items-center justify-center transition-opacity"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 hover:border-indigo-400 hover:text-indigo-500 cursor-pointer transition-all">
                    {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
                    <input type="file" multiple className="hidden" onChange={e => { handleFileUpload(CUSTOM_KEY, name, e.target.files); e.currentTarget.value = ''; }} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
