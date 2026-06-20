
import React, { useEffect, useRef } from 'react';
import { Layers, Palette, Ruler, Trash2, Plus, Split, X, Scan, ImageIcon } from 'lucide-react';
import { Style, StyleCategory } from '../../types';
import { ConsumptionInput } from './ConsumptionInput';

interface CategoryEditorProps {
  category: StyleCategory;
  isEditing: Style | null;
  setIsEditing: (style: Style | null) => void;
  handleFileUpload: (category: string, field: string, files: FileList | null, variantIndex?: number, sizeIndex?: number) => void;
  targetFocus: { category?: string, field?: string } | null;
  /** 'all' (default) renders the special colour/size/packing blocks inline. 'fields' renders only the tech-pack fields. */
  mode?: 'all' | 'fields';
}

export const CategoryEditor: React.FC<CategoryEditorProps> = ({ 
  category, 
  isEditing, 
  setIsEditing, 
  handleFileUpload,
  targetFocus,
  mode = 'all'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (targetFocus?.category === category.name) {
      if (targetFocus.field) {
        const fieldEl = document.getElementById(`field-${category.name}-${targetFocus.field}`);
        fieldEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [targetFocus, category.name]);

  if (!isEditing) return null;
  
  const isPackingReq = category.name.toLowerCase().includes('packing');
  const isPreProduction = category.name.toLowerCase().includes('pre production');
  const showSpecial = mode !== 'fields';
  const availableColors = (isEditing.available_colors || []).filter(c => c.trim() !== '');
  const availableSizes = (isEditing.available_sizes || []).filter(s => s.trim() !== '');

  const handleSplitColor = (fieldName: string) => {
    const updated = { ...isEditing };
    if (!updated.tech_pack[category.name]) updated.tech_pack[category.name] = {};
    const current = updated.tech_pack[category.name][fieldName] || { text: '', attachments: [] };
    
    if (!current.variants) {
      current.variants = [{ colors: [], text: current.text, attachments: current.attachments, consumption_type: current.consumption_type, consumption_val: current.consumption_val }];
    } else {
      current.variants.push({ colors: [], text: '', attachments: [] });
    }
    
    updated.tech_pack[category.name][fieldName] = current;
    setIsEditing(updated);
  };

  const handleAddSizeGroup = (fieldName: string, vIdx: number) => {
    const updated = { ...isEditing };
    const variant = updated.tech_pack[category.name][fieldName].variants![vIdx];
    
    if (!variant.sizeVariants) {
      variant.sizeVariants = [{ sizes: [], text: '', attachments: [], consumption_type: variant.consumption_type, consumption_val: variant.consumption_val }];
    } else {
      variant.sizeVariants.push({ sizes: [], text: '', attachments: [] });
    }
    
    setIsEditing(updated);
  };

  const handleUnsplit = (fieldName: string) => {
    if (!confirm("Merge all variants into one global instruction?")) return;
    const updated = { ...isEditing };
    const current = updated.tech_pack[category.name][fieldName];
    if (current && current.variants) {
      current.text = current.variants[0].text;
      current.attachments = current.variants[0].attachments;
      current.consumption_type = current.variants[0].consumption_type;
      current.consumption_val = current.variants[0].consumption_val;
      delete current.variants;
    }
    setIsEditing(updated);
  };

  return (
    <div ref={containerRef} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm mb-6">
      <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-indigo-600"/>
          <h4 className="font-black text-slate-700 text-xs uppercase tracking-widest">{category.name}</h4>
        </div>
      </div>
      
      <div className="p-6 space-y-8">
        {isPreProduction && showSpecial && (
          <div id={`field-${category.name}-preprod`} className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6 bg-slate-50/50 rounded-2xl border border-slate-100 shadow-inner mb-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-4">
                <Palette size={16} className="text-indigo-600"/>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Blueprint Colours</label>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {(isEditing.available_colors || ['']).map((color, idx) => (
                  <div key={idx} className="flex gap-2 group">
                    <input className="flex-1 border-2 border-slate-200 rounded-xl p-3 bg-white text-slate-900 font-bold focus:border-indigo-500 outline-none transition-all text-sm" placeholder="Type colour..." value={color} onChange={e => { const newCols = [...(isEditing.available_colors || [])]; newCols[idx] = e.target.value; setIsEditing({...isEditing, available_colors: newCols}); }} />
                    <button type="button" onClick={() => { const newCols = (isEditing.available_colors || []).filter((_, i) => i !== idx); setIsEditing({...isEditing, available_colors: newCols.length > 0 ? newCols : ['']}); }} className="p-3 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setIsEditing({...isEditing, available_colors: [...(isEditing.available_colors || []), '']})} className="w-full mt-4 py-2.5 border-2 border-dashed border-indigo-200 text-indigo-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-white flex items-center justify-center gap-2"><Plus size={14}/> Add Colour Row</button>
            </div>
            <div className="flex flex-col">
              <div className="flex justify-between items-center mb-4"><div className="flex items-center gap-2"><Ruler size={16} className="text-indigo-600"/><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Size variants</label></div><div className="flex bg-slate-200 p-1 rounded-lg"><button type="button" onClick={() => setIsEditing({...isEditing, size_type: 'letter', available_sizes: ['S', 'M', 'L', 'XL', 'XXL', '3XL']})} className={`px-3 py-1 rounded-md text-[9px] font-black uppercase transition-all ${isEditing.size_type === 'letter' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>ABC</button><button type="button" onClick={() => setIsEditing({...isEditing, size_type: 'number', available_sizes: ['65', '70', '75', '80', '85', '90']})} className={`px-3 py-1 rounded-md text-[9px] font-black uppercase transition-all ${isEditing.size_type === 'number' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>123</button></div></div>
              <div className="flex-1 flex flex-wrap content-start gap-2 p-3 bg-white rounded-xl border border-slate-200 min-h-[100px]">{isEditing.available_sizes?.map((sz, idx) => (<div key={idx} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-2 shadow-sm">{sz}<button type="button" onClick={() => { const newSizes = isEditing.available_sizes?.filter((_, i) => i !== idx); setIsEditing({...isEditing, available_sizes: newSizes}); }} className="text-white/50 hover:text-white transition-colors"><X size={12}/></button></div>))}</div>
              <button type="button" onClick={() => { const newVal = prompt(`Enter new size:`); if (newVal) setIsEditing({...isEditing, available_sizes: [...(isEditing.available_sizes || []), newVal]}); }} className="w-full mt-4 py-2.5 border-2 border-dashed border-indigo-200 text-indigo-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-white flex items-center justify-center gap-2"><Plus size={14}/> Add custom size</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-12">
          {isPackingReq && showSpecial && (
            <>
              <div id={`field-${category.name}-packing_type`} className="space-y-3"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Type of Packing</label><select className="w-full border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm cursor-pointer" value={isEditing.packing_type} onChange={e => setIsEditing({...isEditing, packing_type: e.target.value})}><option value="pouch">Pouch</option><option value="cover">Cover</option><option value="box">Box</option></select></div>
              <div id={`field-${category.name}-pcs_per_box`} className="space-y-3"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">No of pieces / Box</label><input type="number" className="w-full border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-black focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm" value={isEditing.pcs_per_box} onChange={e => setIsEditing({...isEditing, pcs_per_box: parseInt(e.target.value) || 0})}/></div>
            </>
          )}

          {category.fields.map(field => {
            const item = isEditing.tech_pack[category.name]?.[field] || { text: '', attachments: [] };
            const isSplit = !!item.variants;

            return (
              <div key={field} id={`field-${category.name}-${field}`} className="space-y-4 col-span-full bg-slate-50/30 p-6 rounded-3xl border border-slate-100 transition-all">
                <div className="flex justify-between items-center px-1">
                  <div className="flex items-center gap-3">
                    <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest">{field}</label>
                    {!isSplit && (
                      <ConsumptionInput 
                        type={item.consumption_type} 
                        value={item.consumption_val} 
                        onChange={(t, v) => {
                          const updated = { ...isEditing };
                          if (!updated.tech_pack[category.name]) updated.tech_pack[category.name] = {};
                          updated.tech_pack[category.name][field] = { ...item, consumption_type: t, consumption_val: v };
                          setIsEditing(updated);
                        }}
                        onClear={() => {
                          const updated = { ...isEditing };
                          delete updated.tech_pack[category.name][field].consumption_type;
                          delete updated.tech_pack[category.name][field].consumption_val;
                          setIsEditing(updated);
                        }}
                      />
                    )}
                  </div>
                  {!isSplit ? (
                    <button type="button" onClick={() => handleSplitColor(field)} className="text-[10px] font-black text-indigo-600 bg-white hover:bg-indigo-50 px-4 py-2 rounded-full flex items-center gap-2 border border-indigo-100 transition-all shadow-sm"><Split size={14}/> Split Color-wise</button>
                  ) : (
                    <button type="button" onClick={() => handleUnsplit(field)} className="text-[10px] font-black text-slate-500 bg-white hover:bg-slate-100 px-4 py-2 rounded-full flex items-center gap-2 border border-slate-200 transition-all shadow-sm"><X size={14}/> Merge Global</button>
                  )}
                </div>

                {!isSplit ? (
                  <div className="space-y-3 animate-fade-in">
                    <textarea className="w-full border-2 border-slate-100 rounded-2xl p-5 text-sm font-medium focus:border-indigo-500 outline-none min-h-[100px] bg-white transition-all text-black" value={item.text} placeholder={`Global technical instructions for ${field.toLowerCase()}...`} onChange={e => { const updated = { ...isEditing }; if (!updated.tech_pack[category.name]) updated.tech_pack[category.name] = {}; updated.tech_pack[category.name][field] = { ...item, text: e.target.value }; setIsEditing(updated); }} />
                    <div className="flex flex-wrap gap-2">{item.attachments.map((att, idx) => (<div key={idx} className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-700"> <ImageIcon size={14}/> <span className="truncate max-w-[100px]">{att.name}</span><button type="button" onClick={() => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].attachments.splice(idx, 1); setIsEditing(updated); }} className="hover:text-red-500"><X size={14}/></button></div>))} <label className="bg-white border-2 border-dashed border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2"><Plus size={14}/> Add Attachment <input type="file" multiple className="hidden" onChange={e => handleFileUpload(category.name, field, e.target.files)}/></label></div>
                  </div>
                ) : (
                  <div className="space-y-8 animate-fade-in">
                    {item.variants?.map((variant, vIdx) => (
                      <div key={vIdx} className="bg-white border-2 border-indigo-100 rounded-3xl p-6 shadow-sm relative group">
                        <button type="button" onClick={() => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].variants?.splice(vIdx, 1); setIsEditing(updated); }} className="absolute -top-3 -right-3 bg-red-500 text-white p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"><X size={16}/></button>
                        
                        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-3">
                              <label className="block text-[10px] font-black text-indigo-400 uppercase tracking-widest">Target Color Group</label>
                              <div className="flex gap-1 ml-2">
                                <button type="button" onClick={() => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].variants![vIdx].colors = [...availableColors]; setIsEditing(updated); }} className="text-[8px] font-black uppercase text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 hover:bg-indigo-100 transition-colors">All</button>
                                <button type="button" onClick={() => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].variants![vIdx].colors = []; setIsEditing(updated); }} className="text-[8px] font-black uppercase text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 hover:bg-slate-50 transition-colors">None</button>
                              </div>
                              {!variant.sizeVariants && (
                                <ConsumptionInput 
                                  type={variant.consumption_type} 
                                  value={variant.consumption_val} 
                                  onChange={(t, v) => {
                                    const updated = { ...isEditing };
                                    updated.tech_pack[category.name][field].variants![vIdx] = { ...variant, consumption_type: t, consumption_val: v };
                                    setIsEditing(updated);
                                  }}
                                  onClear={() => {
                                    const updated = { ...isEditing };
                                    delete updated.tech_pack[category.name][field].variants![vIdx].consumption_type;
                                    delete updated.tech_pack[category.name][field].variants![vIdx].consumption_val;
                                    setIsEditing(updated);
                                  }}
                                />
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">{availableColors.map(color => { const isSelected = variant.colors.includes(color); return (<button type="button" key={color} onClick={() => { const updated = { ...isEditing }; const v = updated.tech_pack[category.name][field].variants![vIdx]; if (isSelected) v.colors = v.colors.filter(c => c !== color); else v.colors.push(color); setIsEditing(updated); }} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${isSelected ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>{color}</button>); })} {availableColors.length === 0 && <span className="text-[10px] text-slate-300 italic">No colors defined at top</span>}</div>
                          </div>
                          {!variant.sizeVariants && (
                            <button type="button" onClick={() => handleAddSizeGroup(field, vIdx)} className="text-[10px] font-black text-blue-600 bg-blue-50 px-4 py-2 rounded-full border border-blue-100 flex items-center gap-2 hover:bg-blue-100 transition-all shadow-sm"><Scan size={14}/> Split by Size Group</button>
                          )}
                        </div>

                        {!variant.sizeVariants ? (
                          <div className="space-y-4">
                            <textarea className="w-full border border-slate-100 rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none min-h-[80px] bg-slate-50/50 transition-all text-black" value={variant.text} placeholder="Instructions for these colors..." onChange={e => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].variants![vIdx].text = e.target.value; setIsEditing(updated); }} />
                            <div className="flex flex-wrap gap-2">{variant.attachments.map((att, attIdx) => (<div key={attIdx} className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-lg text-[10px] font-bold text-indigo-700"><span>{att.name}</span><button type="button" onClick={() => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].variants![vIdx].attachments.splice(attIdx, 1); setIsEditing(updated); }} className="hover:text-red-500"><X size={12}/></button></div>))}<label className="bg-white border border-dashed border-slate-200 hover:border-indigo-400 text-slate-400 px-3 py-1.5 rounded-lg text-[10px] font-black transition-all cursor-pointer flex items-center gap-2"><Plus size={12}/> File <input type="file" multiple className="hidden" onChange={e => handleFileUpload(category.name, field, e.target.files, vIdx)}/></label></div>
                          </div>
                        ) : (
                          <div className="space-y-6 border-l-4 border-blue-200 pl-6 py-2 animate-fade-in">
                             <div className="flex justify-between items-center mb-2"><h5 className="text-[11px] font-black text-blue-500 uppercase tracking-widest">Nested Size Groups</h5><button type="button" onClick={() => { if(confirm("Discard all size splits?")) { const updated = { ...isEditing }; delete updated.tech_pack[category.name][field].variants![vIdx].sizeVariants; setIsEditing(updated); } }} className="text-[9px] font-black text-slate-400 uppercase hover:text-red-500 transition-colors">Discard Splits</button></div>
                             
                             {variant.sizeVariants.map((sv, svIdx) => (
                               <div key={svIdx} className="p-5 bg-blue-50/30 rounded-3xl border border-blue-100 space-y-4 relative group/size">
                                 <button type="button" onClick={() => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].variants![vIdx].sizeVariants?.splice(svIdx, 1); setIsEditing(updated); }} className="absolute -top-2 -right-2 bg-white text-red-400 p-1.5 rounded-full shadow border border-red-50 opacity-0 group-hover/size:opacity-100 transition-opacity"><Trash2 size={12}/></button>
                                 
                                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                   <div>
                                     <div className="flex items-center gap-3 mb-2">
                                       <label className="block text-[9px] font-black text-blue-400 uppercase tracking-widest">Apply to Sizes</label>
                                       <div className="flex gap-1">
                                         <button type="button" onClick={() => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].variants![vIdx].sizeVariants![svIdx].sizes = [...availableSizes]; setIsEditing(updated); }} className="text-[7px] font-black uppercase text-blue-600 bg-white px-1.5 py-0.5 rounded border border-blue-100 hover:bg-blue-50 transition-colors">All</button>
                                         <button type="button" onClick={() => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].variants![vIdx].sizeVariants![svIdx].sizes = []; setIsEditing(updated); }} className="text-[7px] font-black uppercase text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50 transition-colors">None</button>
                                       </div>
                                     </div>
                                     <div className="flex flex-wrap gap-1.5">
                                       {availableSizes.map(sz => {
                                         const isSzSelected = sv.sizes.includes(sz);
                                         return (
                                           <button
                                             type="button"
                                             key={sz}
                                             onClick={() => {
                                               const updated = { ...isEditing };
                                               const sVar = updated.tech_pack[category.name][field].variants![vIdx].sizeVariants![svIdx];
                                               if (isSzSelected) sVar.sizes = sVar.sizes.filter(s => s !== sz);
                                               else sVar.sizes.push(sz);
                                               setIsEditing(updated);
                                             }}
                                             className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${isSzSelected ? 'bg-blue-600 text-white' : 'bg-white text-blue-300 border border-blue-50 hover:bg-blue-50'}`}
                                           >
                                             {sz}
                                           </button>
                                         );
                                       })}
                                     </div>
                                   </div>
                                   <ConsumptionInput 
                                    type={sv.consumption_type} 
                                    value={sv.consumption_val} 
                                    onChange={(t, v) => {
                                      const updated = { ...isEditing };
                                      updated.tech_pack[category.name][field].variants![vIdx].sizeVariants![svIdx] = { ...sv, consumption_type: t, consumption_val: v };
                                      setIsEditing(updated);
                                    }}
                                    onClear={() => {
                                      const updated = { ...isEditing };
                                      delete updated.tech_pack[category.name][field].variants![vIdx].sizeVariants![svIdx].consumption_type;
                                      delete updated.tech_pack[category.name][field].variants![vIdx].sizeVariants![svIdx].consumption_val;
                                      setIsEditing(updated);
                                    }}
                                  />
                                 </div>

                                 <textarea className="w-full border-2 border-white rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none bg-white min-h-[70px] text-black transition-all" value={sv.text} placeholder={`Specific instructions for the selected sizes...`} onChange={e => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].variants![vIdx].sizeVariants![svIdx].text = e.target.value; setIsEditing(updated); }}/>
                                 
                                 <div className="flex flex-wrap gap-2">
                                    {sv.attachments.map((att, attIdx) => (<div key={attIdx} className="flex items-center gap-2 bg-white border border-blue-50 px-2 py-1 rounded-lg text-[9px] font-bold text-blue-700"><span>{att.name}</span><button type="button" onClick={() => { const updated = { ...isEditing }; updated.tech_pack[category.name][field].variants![vIdx].sizeVariants![svIdx].attachments.splice(attIdx, 1); setIsEditing(updated); }} className="text-red-400"><X size={10}/></button></div>))}
                                    <label className="bg-white border-2 border-dashed border-blue-100 hover:border-blue-400 text-blue-300 px-3 py-1 rounded-xl text-[9px] font-black cursor-pointer flex items-center gap-2"><Plus size={12}/> File <input type="file" multiple className="hidden" onChange={e => handleFileUpload(category.name, field, e.target.files, vIdx, svIdx)}/></label>
                                 </div>
                               </div>
                             ))}
                             
                             <button type="button" onClick={() => handleAddSizeGroup(field, vIdx)} className="w-full py-3 border-2 border-dashed border-blue-100 text-blue-300 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-blue-50 hover:text-blue-500 transition-all">+ Add Nested Size Group</button>
                          </div>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => handleSplitColor(field)} className="w-full py-5 border-4 border-dashed border-slate-100 text-slate-300 text-[11px] font-black uppercase tracking-[0.2em] rounded-3xl hover:border-indigo-200 hover:text-indigo-400 transition-all">+ Add Color Variant Group</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
