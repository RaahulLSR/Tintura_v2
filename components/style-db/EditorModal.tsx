
import React from 'react';
import { X, Copy, Plus, Save, Loader2 } from 'lucide-react';
import { Style, StyleTemplate } from '../../types';
import { CategoryEditor } from './CategoryEditor';

interface EditorModalProps {
  isEditing: Style;
  styles: Style[];
  template: StyleTemplate | null;
  setIsEditing: (style: Style | null) => void;
  handleSaveStyle: (e: React.FormEvent) => void;
  handleCopyStyle: (sourceStyle: Style) => void;
  handleFileUpload: (category: string, field: string, files: FileList | null, variantIndex?: number, sizeIndex?: number) => void;
  editTarget: { category?: string, field?: string } | null;
  garmentTypeOptions: string[];
  setGarmentTypeOptions: (opts: string[]) => void;
  demographicOptions: string[];
  setDemographicOptions: (opts: string[]) => void;
  isUploading: boolean;
}

export const EditorModal: React.FC<EditorModalProps> = ({
  isEditing,
  styles,
  template,
  setIsEditing,
  handleSaveStyle,
  handleCopyStyle,
  handleFileUpload,
  editTarget,
  garmentTypeOptions,
  setGarmentTypeOptions,
  demographicOptions,
  setDemographicOptions,
  isUploading
}) => {
  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[95vh] overflow-hidden flex flex-col animate-scale-up border border-slate-200">
        <div className="p-8 border-b bg-slate-50 flex justify-between items-center">
          <div>
            <h3 className="text-3xl font-black text-slate-800 tracking-tight">{isEditing.id ? `Editing Style ${isEditing.style_number}` : 'New Style Blueprint'}</h3>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Define technical details and variant specific instructions</p>
          </div>
          <div className="flex items-center gap-4">
            {!isEditing.id && (
              <button 
                type="button" 
                onClick={() => {
                  const source = prompt("Enter Style Number to copy from:");
                  if (source) {
                    const match = styles.find(s => s.style_number.toLowerCase() === source.toLowerCase());
                    if (match) handleCopyStyle(match);
                    else alert("Style not found.");
                  }
                }}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-black border border-indigo-100 hover:bg-indigo-100"
              >
                <Copy size={16}/> Copy Existing
              </button>
            )}
            <button onClick={() => setIsEditing(null)} className="text-slate-300 hover:text-slate-600 transition-colors p-2 hover:bg-slate-100 rounded-full"><X size={32}/></button>
          </div>
        </div>
        <form onSubmit={handleSaveStyle} className="flex-1 overflow-y-auto p-8 bg-slate-50/30">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-10">
            <div className="col-span-1"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Style Number</label><input required className="w-full border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm transition-all" value={isEditing.style_number} onChange={e => setIsEditing({...isEditing, style_number: e.target.value})}/></div>
            <div className="col-span-1"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Garment Type</label><div className="flex gap-2"><select className="flex-1 border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer" value={isEditing.garment_type} onChange={e => setIsEditing({...isEditing, garment_type: e.target.value})}>{garmentTypeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select><button type="button" onClick={() => { const v = prompt("New Garment Type:"); if(v) setGarmentTypeOptions([...garmentTypeOptions, v]); }} className="p-4 bg-white border-2 border-slate-100 rounded-xl text-indigo-600"><Plus size={20}/></button></div></div>
            <div className="col-span-1"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Demographic</label><div className="flex gap-2"><select className="flex-1 border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer" value={isEditing.demographic} onChange={e => setIsEditing({...isEditing, demographic: e.target.value})}>{demographicOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select><button type="button" onClick={() => { const v = prompt("New Demographic:"); if(v) setDemographicOptions([...demographicOptions, v]); }} className="p-4 bg-white border-2 border-slate-100 rounded-xl text-indigo-600"><Plus size={20}/></button></div></div>
            <div className="col-span-1"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Category</label><select className="w-full border-2 border-slate-100 rounded-xl p-4 bg-white font-bold focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer" value={isEditing.category} onChange={e => setIsEditing({...isEditing, category: e.target.value})}><option value="Casuals">Casuals</option><option value="Lite">Lite</option><option value="Sportz">Sportz</option></select></div>
            <div className="col-span-1"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Short Description</label><input className="w-full border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all" value={isEditing.style_text} onChange={e => setIsEditing({...isEditing, style_text: e.target.value})}/></div>
          </div>
          {template?.config.filter(cat => cat.name !== "General Info").map(cat => (<CategoryEditor key={cat.name} category={cat} isEditing={isEditing} setIsEditing={setIsEditing} handleFileUpload={handleFileUpload} targetFocus={editTarget} />))}
        </form>
        <div className="p-8 border-t bg-white flex justify-between items-center shadow-2xl"><button type="button" onClick={() => setIsEditing(null)} className="px-10 py-4 font-black text-slate-400 hover:text-slate-600 transition-all uppercase text-xs">Cancel</button><button onClick={handleSaveStyle} disabled={isUploading} className="px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-2xl shadow-indigo-200 flex items-center gap-3 active:scale-95 disabled:opacity-50 uppercase text-xs">{isUploading ? <Loader2 size={20} className="animate-spin" /> : <Save size={20}/>} Commit Style Blueprint</button></div>
      </div>
    </div>
  );
};
