import React, { useMemo, useState, useEffect } from 'react';
import { X, RefreshCcw, FilePlus, CheckSquare, Square, Info, Save, Loader2, Plus, Split, Scan, ImageIcon, Trash2, LayoutGrid, Calculator, Ruler } from 'lucide-react';
import { Style, StyleTemplate, Attachment, TechPackItem, Order, SizeBreakdown } from '../../types';
import { ConsumptionInput } from './ConsumptionInput';
import { uploadOrderAttachment, upsertStyle } from '../../services/db';

interface BulkUpdateModalProps {
  styles: Style[];
  template: StyleTemplate | null;
  selectedStyleIds: string[];
  bulkUpdateMeta: {
    strategy: 'overwrite' | 'append';
  };
  setBulkUpdateMeta: (meta: any) => void;
  bulkFieldValues: Record<string, { isEnabled: boolean } & TechPackItem>;
  setBulkFieldValues: (vals: any) => void;
  isUploading: boolean;
  setIsUploading: (val: boolean) => void;
  onClose: () => void;
  onExecute: () => void;
  unionColors: string[];
  unionSizes: string[];
  orders: Order[];
}

export const BulkUpdateModal: React.FC<BulkUpdateModalProps> = ({ 
  styles, 
  template, 
  selectedStyleIds, 
  bulkUpdateMeta, 
  setBulkUpdateMeta, 
  bulkFieldValues, 
  setBulkFieldValues, 
  isUploading, 
  setIsUploading, 
  onClose, 
  onExecute,
  unionColors,
  unionSizes,
  orders
}) => {
  const [localUnionSizes, setLocalUnionSizes] = useState<string[]>([]);
  const [newSizeInput, setNewSizeInput] = useState('');

  useEffect(() => {
    setLocalUnionSizes(unionSizes);
  }, [unionSizes]);

  const handleAddNewSize = () => {
    if (!newSizeInput.trim()) return;
    if (localUnionSizes.includes(newSizeInput.trim())) return;
    setLocalUnionSizes(prev => [...prev, newSizeInput.trim()].sort());
    setNewSizeInput('');
  };

  const handleFieldChange = (key: string, updates: Partial<TechPackItem>) => {
    setBulkFieldValues((prev: any) => ({
      ...prev,
      [key]: { ...prev[key], ...updates }
    }));
  };

  const handleSplitColor = (key: string) => {
    const current = bulkFieldValues[key];
    if (!current.variants) {
      handleFieldChange(key, {
        variants: [{ colors: [], text: current.text || '', attachments: current.attachments || [], consumption_type: current.consumption_type, consumption_val: current.consumption_val }]
      });
    } else {
      handleFieldChange(key, {
        variants: [...current.variants, { colors: [], text: '', attachments: [] }]
      });
    }
  };

  const handleAddSizeGroup = (key: string, vIdx: number) => {
    const current = { ...bulkFieldValues[key] };
    const variant = current.variants![vIdx];
    if (!variant.sizeVariants) {
      variant.sizeVariants = [{ sizes: [], text: '', attachments: [], consumption_type: variant.consumption_type, consumption_val: variant.consumption_val }];
    } else {
      variant.sizeVariants.push({ sizes: [], text: '', attachments: [] });
    }
    setBulkFieldValues((prev: any) => ({ ...prev, [key]: current }));
  };

  const handleUnsplit = (key: string) => {
    const current = bulkFieldValues[key];
    if (current.variants) {
      handleFieldChange(key, {
        text: current.variants[0].text,
        attachments: current.variants[0].attachments,
        consumption_type: current.variants[0].consumption_type,
        consumption_val: current.variants[0].consumption_val,
        variants: undefined
      });
    }
  };

  // Override onExecute to handle available_sizes synchronization
  const handleEnhancedExecute = async () => {
    if (selectedStyleIds.length === 0) return;
    setIsUploading(true);
    try {
      const selectedStyles = styles.filter(s => selectedStyleIds.includes(s.id));
      const enabledUpdates = (Object.entries(bulkFieldValues) as [string, typeof bulkFieldValues[string]][]).filter(([_, val]) => val.isEnabled);
      
      if (enabledUpdates.length === 0) {
        alert("Please select at least one field to update.");
        setIsUploading(false);
        return;
      }

      for (const style of selectedStyles) {
        const updatedStyle = JSON.parse(JSON.stringify(style));
        const { strategy } = bulkUpdateMeta;

        for (const [key, fieldData] of enabledUpdates) {
          const [category, field] = key.split('|');
          if (!updatedStyle.tech_pack[category]) updatedStyle.tech_pack[category] = {};
          
          const mergeText = (current: string, next: string) => strategy === 'overwrite' ? next : (current ? current + '\n' + next : next);
          const mergeAttachments = (current: Attachment[], next: Attachment[]) => strategy === 'overwrite' ? next : [...(current || []), ...next];

          const bulkItem = { ...fieldData };
          delete (bulkItem as any).isEnabled;

          const currentItem = updatedStyle.tech_pack[category][field] || { text: '', attachments: [] };

          if (!bulkItem.variants) {
            currentItem.text = mergeText(currentItem.text, bulkItem.text);
            currentItem.attachments = mergeAttachments(currentItem.attachments, bulkItem.attachments);
            if (bulkItem.consumption_type) currentItem.consumption_type = bulkItem.consumption_type;
            if (bulkItem.consumption_val !== undefined) currentItem.consumption_val = bulkItem.consumption_val;
            if (strategy === 'overwrite') delete (currentItem as any).variants;
          } else {
            if (strategy === 'overwrite') {
               currentItem.variants = [];
               delete (currentItem as any).text;
               delete (currentItem as any).attachments;
            } else if (!currentItem.variants) {
               currentItem.variants = [];
            }

            bulkItem.variants.forEach(bulkVar => {
              const validColors = bulkVar.colors.filter(c => updatedStyle.available_colors?.includes(c));
              if (validColors.length === 0) return;

              let targetVar = currentItem.variants!.find(v => JSON.stringify(v.colors.sort()) === JSON.stringify(validColors.sort()));
              if (!targetVar) {
                targetVar = { colors: validColors, text: '', attachments: [] };
                currentItem.variants!.push(targetVar);
              }

              if (!bulkVar.sizeVariants) {
                targetVar.text = mergeText(targetVar.text, bulkVar.text);
                targetVar.attachments = mergeAttachments(targetVar.attachments, bulkVar.attachments);
                if (bulkVar.consumption_type) targetVar.consumption_type = bulkVar.consumption_type;
                if (bulkVar.consumption_val !== undefined) targetVar.consumption_val = bulkVar.consumption_val;
                if (strategy === 'overwrite') delete (targetVar as any).sizeVariants;
              } else {
                if (strategy === 'overwrite') {
                  targetVar.sizeVariants = [];
                  delete (targetVar as any).text;
                  delete (targetVar as any).attachments;
                } else if (!targetVar.sizeVariants) {
                  targetVar.sizeVariants = [];
                }

                bulkVar.sizeVariants.forEach(bulkSizeVar => {
                  // NEW: If we select a size in bulk edit, ensure it's added to the style's available pool if missing
                  const sizesToInject = bulkSizeVar.sizes.filter(s => !updatedStyle.available_sizes?.includes(s));
                  if (sizesToInject.length > 0) {
                    updatedStyle.available_sizes = Array.from(new Set([...(updatedStyle.available_sizes || []), ...sizesToInject])).sort();
                  }

                  let targetSizeVar = targetVar!.sizeVariants!.find(sv => JSON.stringify(sv.sizes.sort()) === JSON.stringify(bulkSizeVar.sizes.sort()));
                  if (!targetSizeVar) {
                    targetSizeVar = { sizes: bulkSizeVar.sizes, text: '', attachments: [] };
                    targetVar!.sizeVariants!.push(targetSizeVar);
                  }

                  targetSizeVar.text = mergeText(targetSizeVar.text, bulkSizeVar.text);
                  targetSizeVar.attachments = mergeAttachments(targetSizeVar.attachments, bulkSizeVar.attachments);
                  if (bulkSizeVar.consumption_type) targetSizeVar.consumption_type = bulkSizeVar.consumption_type;
                  if (bulkSizeVar.consumption_val !== undefined) targetSizeVar.consumption_val = bulkSizeVar.consumption_val;
                });
              }
            });
          }
          updatedStyle.tech_pack[category][field] = currentItem;
        }
        await upsertStyle(updatedStyle);
      }
      alert("Bulk update completed successfully.");
      onClose();
      onExecute(); // Parent refresh
    } catch (err) {
      alert("Error during bulk update: " + err);
    } finally {
      setIsUploading(false);
    }
  };

  // --- Aggregate Order Data ---
  const productionAggregate = useMemo(() => {
    const selectedStyles = styles.filter(s => selectedStyleIds.includes(s.id));
    const selectedStyleNums = selectedStyles.map(s => s.style_number.toLowerCase());
    
    const relevantOrders = orders.filter(o => {
      const baseStyleNum = o.style_number.split(' - ')[0].trim().toLowerCase();
      return selectedStyleNums.includes(baseStyleNum);
    });

    const matrix: Record<string, Record<string, number>> = {};
    unionColors.forEach(c => {
      matrix[c] = {};
      localUnionSizes.forEach(s => {
        matrix[c][s] = 0;
      });
    });

    relevantOrders.forEach(order => {
      const isNumeric = order.size_format === 'numeric';
      const sizeMap = isNumeric 
        ? { 's': '65', 'm': '70', 'l': '75', 'xl': '80', 'xxl': '85', 'xxxl': '90' }
        : { 's': 'S', 'm': 'M', 'l': 'L', 'xl': 'XL', 'xxl': 'XXL', 'xxxl': '3XL' };

      order.size_breakdown?.forEach(row => {
        if (matrix[row.color]) {
          Object.entries(sizeMap).forEach(([key, label]) => {
            if (matrix[row.color][label] !== undefined) {
              matrix[row.color][label] += (row as any)[key] || 0;
            }
          });
        }
      });
    });

    return matrix;
  }, [selectedStyleIds, styles, orders, unionColors, localUnionSizes]);

  const totalProductionCount = useMemo(() => {
    let total = 0;
    Object.values(productionAggregate).forEach(row => {
      Object.values(row).forEach(val => total += (val as number));
    });
    return total;
  }, [productionAggregate]);

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[90vw] overflow-hidden animate-scale-up border border-slate-200 flex flex-col max-h-[95vh]">
        <div className="p-8 border-b bg-orange-50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-orange-600 text-white rounded-2xl shadow-lg">
              <RefreshCcw size={32}/>
            </div>
            <div>
              <h3 className="text-2xl font-black text-orange-900 uppercase tracking-tight">Bulk Blueprint Synchronizer</h3>
              <p className="text-orange-700 text-xs font-bold uppercase tracking-widest mt-1">Applying technical updates to {selectedStyleIds.length} blueprints</p>
            </div>
          </div>
          <button onClick={onClose} className="text-orange-300 hover:text-orange-600 transition-colors p-2"><X size={32}/></button>
        </div>
        
        <div className="p-8 flex-1 overflow-y-auto space-y-8 bg-slate-50/50">
           
           <div className="bg-white rounded-3xl border border-orange-200 p-6 shadow-sm flex flex-col md:flex-row items-center gap-6">
              <div className="flex items-center gap-3 shrink-0">
                 <div className="p-3 bg-orange-100 text-orange-600 rounded-xl">
                    <Ruler size={24}/>
                 </div>
                 <div>
                    <h4 className="font-black text-orange-900 text-sm uppercase">Inject New Sizes</h4>
                    <p className="text-orange-400 text-[10px] font-bold uppercase tracking-widest">Add sizes (like 55, 50) that don't exist yet</p>
                 </div>
              </div>
              <div className="flex-1 flex gap-2 w-full">
                 <input 
                   type="text" 
                   placeholder="e.g. 55"
                   className="flex-1 border-2 border-slate-100 rounded-xl px-5 py-3 font-bold focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                   value={newSizeInput}
                   onChange={e => setNewSizeInput(e.target.value)}
                   onKeyDown={e => e.key === 'Enter' && handleAddNewSize()}
                 />
                 <button 
                   onClick={handleAddNewSize}
                   className="bg-orange-600 text-white px-6 py-3 rounded-xl font-black uppercase text-xs hover:bg-orange-700 transition-all flex items-center gap-2"
                 >
                   <Plus size={16}/> Add Size to Pool
                 </button>
              </div>
           </div>

           {totalProductionCount > 0 && (
             <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden animate-fade-in">
                <div className="p-5 border-b bg-slate-900 text-white flex justify-between items-center">
                   <div className="flex items-center gap-3">
                      <LayoutGrid size={20} className="text-indigo-400"/>
                      <h4 className="font-black uppercase tracking-widest text-sm">Aggregated Order Volume (Unit 1 → All)</h4>
                   </div>
                   <div className="flex items-center gap-4">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Batch Volume</span>
                      <span className="text-2xl font-black text-indigo-400">{totalProductionCount} PCS</span>
                   </div>
                </div>
                <div className="overflow-x-auto">
                   <table className="w-full text-center text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[9px] tracking-widest border-b">
                         <tr>
                            <th className="p-4 text-left border-r sticky left-0 bg-slate-50">Color Variant</th>
                            {localUnionSizes.map(sz => <th key={sz} className="p-4 border-r">{sz}</th>)}
                            <th className="p-4 bg-slate-100 font-black">Sum</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                         {unionColors.map(color => {
                           const row = productionAggregate[color];
                           const rowTotal = (Object.values(row) as number[]).reduce((a,b) => a+b, 0);
                           if (rowTotal === 0) return null;
                           return (
                             <tr key={color} className="hover:bg-indigo-50/30 transition-colors">
                                <td className="p-4 text-left font-black text-slate-800 border-r sticky left-0 bg-white group-hover:bg-indigo-50/30">{color}</td>
                                {localUnionSizes.map(sz => (
                                  <td key={sz} className={`p-4 border-r tabular-nums font-bold ${row[sz] > 0 ? 'text-indigo-600 bg-indigo-50/20' : 'text-slate-200'}`}>
                                    {row[sz] || '-'}
                                  </td>
                                ))}
                                <td className="p-4 font-black text-slate-900 bg-slate-50 tabular-nums">{rowTotal}</td>
                             </tr>
                           );
                         })}
                      </tbody>
                   </table>
                </div>
             </div>
           )}

           <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="flex-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Merge Strategy</label>
                <div className="flex bg-orange-100/50 p-1 rounded-xl border border-orange-100 max-w-md">
                  <button onClick={() => setBulkUpdateMeta({...bulkUpdateMeta, strategy: 'overwrite'})} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2 ${bulkUpdateMeta.strategy === 'overwrite' ? 'bg-orange-600 text-white shadow-md' : 'text-orange-500 hover:bg-orange-100'}`}>
                    <RefreshCcw size={14}/> Overwrite
                  </button>
                  <button onClick={() => setBulkUpdateMeta({...bulkUpdateMeta, strategy: 'append'})} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2 ${bulkUpdateMeta.strategy === 'append' ? 'bg-indigo-600 text-white shadow-md' : 'text-indigo-500 hover:bg-indigo-50'}`}>
                    <FilePlus size={14}/> Append to existing
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 text-indigo-500 bg-indigo-50 p-4 rounded-2xl border border-indigo-100 max-w-sm">
                <Info size={24}/>
                <p className="text-[10px] font-bold uppercase leading-relaxed">Splits are based on a union of all database attributes. Attributes not present in a specific style will be ignored during sync.</p>
              </div>
           </div>

           {template?.config.map(cat => (
             <div key={cat.name} className="space-y-4">
                <div className="flex items-center gap-3 px-4">
                  <div className="h-px flex-1 bg-slate-200"></div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">{cat.name}</span>
                  <div className="h-px flex-1 bg-slate-200"></div>
                </div>
                
                <div className="grid grid-cols-1 gap-6">
                  {cat.fields.map(f => {
                    const fieldKey = `${cat.name}|${f}`;
                    const fieldData = bulkFieldValues[fieldKey];
                    if (!fieldData) return null;
                    const isSplit = !!fieldData.variants;

                    return (
                      <div key={f} className={`bg-white rounded-3xl border transition-all duration-300 ${fieldData.isEnabled ? 'border-indigo-500 ring-4 ring-indigo-50 shadow-xl' : 'border-slate-200 opacity-60 grayscale'}`}>
                         <div className="p-6 flex items-center justify-between border-b border-slate-50">
                            <div className="flex items-center gap-4">
                               <button 
                                  onClick={() => setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: { ...prev[fieldKey], isEnabled: !prev[fieldKey].isEnabled } }))}
                                  className={`p-2 rounded-xl transition-all ${fieldData.isEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}
                               >
                                  {fieldData.isEnabled ? <CheckSquare size={24}/> : <Square size={24}/>}
                               </button>
                               <div>
                                  <h5 className="font-black text-slate-800 uppercase tracking-tight">{f}</h5>
                                  <p className="text-[10px] text-slate-400 font-bold uppercase">Toggle to sync this attribute</p>
                               </div>
                            </div>
                            
                            {fieldData.isEnabled && (
                              <div className="flex items-center gap-4">
                                {!isSplit ? (
                                  <>
                                    <ConsumptionInput 
                                      type={fieldData.consumption_type}
                                      value={fieldData.consumption_val}
                                      onChange={(t, v) => handleFieldChange(fieldKey, { consumption_type: t, consumption_val: v })}
                                      onClear={() => handleFieldChange(fieldKey, { consumption_type: undefined, consumption_val: undefined })}
                                    />
                                    <button type="button" onClick={() => handleSplitColor(fieldKey)} className="text-[10px] font-black text-indigo-600 bg-white hover:bg-indigo-50 px-4 py-2 rounded-full flex items-center gap-2 border border-indigo-100 transition-all shadow-sm"><Split size={14}/> Split Color-wise</button>
                                  </>
                                ) : (
                                  <button type="button" onClick={() => handleUnsplit(fieldKey)} className="text-[10px] font-black text-slate-500 bg-white hover:bg-slate-100 px-4 py-2 rounded-full flex items-center gap-2 border border-slate-200 transition-all shadow-sm"><X size={14}/> Merge Global</button>
                                )}
                              </div>
                            )}
                         </div>

                         {fieldData.isEnabled && (
                           <div className="p-6 space-y-6 animate-fade-in bg-slate-50/20">
                              {!isSplit ? (
                                <div className="space-y-4">
                                  <textarea 
                                    className="w-full border-2 border-slate-100 rounded-2xl p-4 h-32 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium bg-white shadow-sm"
                                    placeholder={bulkUpdateMeta.strategy === 'append' ? `Content to append...` : `Content to overwrite...`}
                                    value={fieldData.text || ''}
                                    onChange={e => handleFieldChange(fieldKey, { text: e.target.value })}
                                  />
                                  <div className="flex flex-wrap gap-2">
                                    {fieldData.attachments?.map((a: Attachment, idx: number) => (
                                      <div key={idx} className="flex items-center gap-1.5 bg-indigo-50 px-3 py-1.5 rounded-lg text-[9px] font-black text-indigo-700 border border-indigo-100">
                                        <ImageIcon size={10}/> {a.name} <button onClick={() => handleFieldChange(fieldKey, { attachments: fieldData.attachments.filter((_: any, i: number) => i !== idx) })}><X size={10}/></button>
                                      </div>
                                    ))}
                                    <label className="bg-white border-2 border-dashed border-slate-200 hover:border-indigo-400 text-slate-400 px-4 py-2 rounded-xl text-[10px] font-black cursor-pointer flex items-center gap-2 transition-all">
                                      <Plus size={14}/> Add File
                                      <input 
                                        type="file" multiple className="hidden" 
                                        onChange={async (e) => {
                                          if (!e.target.files) return;
                                          setIsUploading(true);
                                          const newAtts = [];
                                          const files = Array.from(e.target.files) as File[];
                                          for (const file of files) {
                                            const url = await uploadOrderAttachment(file);
                                            if (url) newAtts.push({ name: file.name, url, type: file.type.startsWith('image/') ? 'image' : 'document' });
                                          }
                                          handleFieldChange(fieldKey, { attachments: [...(fieldData.attachments || []), ...newAtts] });
                                          setIsUploading(false);
                                        }}
                                      />
                                    </label>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-6">
                                  {fieldData.variants?.map((v, vIdx) => (
                                    <div key={vIdx} className="bg-white border-2 border-indigo-100 rounded-3xl p-6 shadow-sm relative group/var">
                                      <button type="button" onClick={() => { const updated = { ...fieldData }; updated.variants?.splice(vIdx, 1); setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }} className="absolute -top-3 -right-3 bg-red-500 text-white p-2 rounded-full shadow-lg opacity-0 group-hover/var:opacity-100 transition-opacity"><X size={16}/></button>
                                      
                                      <div className="mb-6 flex flex-col md:flex-row md:items-start justify-between gap-6">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-3 mb-3">
                                            <label className="block text-[10px] font-black text-indigo-400 uppercase tracking-widest">Global Attribute Union (Colors)</label>
                                            <div className="flex gap-1 ml-2">
                                              <button type="button" onClick={() => { const updated = { ...fieldData }; updated.variants![vIdx].colors = [...unionColors]; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }} className="text-[8px] font-black uppercase text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 hover:bg-indigo-100 transition-colors">All</button>
                                              <button type="button" onClick={() => { const updated = { ...fieldData }; updated.variants![vIdx].colors = []; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }} className="text-[8px] font-black uppercase text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 hover:bg-slate-50 transition-colors">None</button>
                                            </div>
                                            {!v.sizeVariants && (
                                              <ConsumptionInput 
                                                type={v.consumption_type}
                                                value={v.consumption_val}
                                                onChange={(t, val) => { const updated = { ...fieldData }; updated.variants![vIdx] = { ...v, consumption_type: t, consumption_val: val }; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }}
                                                onClear={() => { const updated = { ...fieldData }; delete updated.variants![vIdx].consumption_type; delete updated.variants![vIdx].consumption_val; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }}
                                              />
                                            )}
                                          </div>
                                          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1">
                                            {unionColors.map(color => {
                                              const isSel = v.colors.includes(color);
                                              return (
                                                <button key={color} type="button" onClick={() => { const updated = { ...fieldData }; const varObj = updated.variants![vIdx]; if (isSel) varObj.colors = varObj.colors.filter(c => c !== color); else varObj.colors.push(color); setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }} className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-all ${isSel ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:bg-slate-100'}`}>{color}</button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                        {!v.sizeVariants && (
                                          <button type="button" onClick={() => handleAddSizeGroup(fieldKey, vIdx)} className="text-[10px] font-black text-blue-600 bg-blue-50 px-4 py-2 rounded-full border border-blue-100 flex items-center gap-2 hover:bg-blue-100 transition-all shadow-sm"><Scan size={14}/> Split by Size Group</button>
                                        )}
                                      </div>

                                      {!v.sizeVariants ? (
                                        <div className="space-y-4">
                                          <textarea 
                                            className="w-full border border-slate-100 rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50/50"
                                            placeholder="Instructions for selected color union..."
                                            value={v.text}
                                            onChange={e => { const updated = { ...fieldData }; updated.variants![vIdx].text = e.target.value; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }}
                                          />
                                          <div className="flex flex-wrap gap-2">
                                            {v.attachments.map((a, aIdx) => (
                                              <div key={aIdx} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-1 rounded text-[9px] font-black border border-indigo-100">
                                                {a.name} <button onClick={() => { const updated = { ...fieldData }; updated.variants![vIdx].attachments.splice(aIdx, 1); setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }}><X size={10}/></button>
                                              </div>
                                            ))}
                                            <label className="bg-white border-2 border-dashed border-slate-200 text-slate-400 px-3 py-1 rounded-lg text-[10px] font-black cursor-pointer hover:bg-slate-50 transition-all">
                                              + File
                                              <input type="file" multiple className="hidden" onChange={async (e) => {
                                                if (!e.target.files) return;
                                                setIsUploading(true);
                                                const newAtts = [];
                                                const files = Array.from(e.target.files) as File[];
                                                for (const file of files) {
                                                  const url = await uploadOrderAttachment(file);
                                                  if (url) newAtts.push({ name: file.name, url, type: file.type.startsWith('image/') ? 'image' : 'document' });
                                                }
                                                const updated = { ...fieldData };
                                                updated.variants![vIdx].attachments = [...(updated.variants![vIdx].attachments || []), ...newAtts];
                                                setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated }));
                                                setIsUploading(false);
                                              }}/>
                                            </label>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="space-y-6 border-l-4 border-blue-200 pl-6 py-2">
                                          <div className="flex justify-between items-center"><h6 className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Nested Size Sub-Splits</h6><button type="button" onClick={() => { const updated = { ...fieldData }; delete updated.variants![vIdx].sizeVariants; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }} className="text-[9px] font-black text-slate-400 uppercase hover:text-red-500">Discard Splits</button></div>
                                          {v.sizeVariants.map((sv, svIdx) => (
                                            <div key={svIdx} className="p-4 bg-blue-50/20 rounded-2xl border border-blue-100 space-y-4 relative group/size">
                                              <button type="button" onClick={() => { const updated = { ...fieldData }; updated.variants![vIdx].sizeVariants?.splice(svIdx, 1); setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }} className="absolute -top-2 -right-2 bg-white text-red-400 p-1.5 rounded-full shadow border opacity-0 group-hover/size:opacity-100 transition-opacity"><Trash2 size={12}/></button>
                                              
                                              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                                                <div className="flex-1">
                                                  <div className="flex items-center gap-3 mb-2">
                                                    <label className="block text-[9px] font-black text-blue-400 uppercase tracking-widest">Apply to Sizes (Extended Pool)</label>
                                                    <div className="flex gap-1">
                                                      <button type="button" onClick={() => { const updated = { ...fieldData }; updated.variants![vIdx].sizeVariants![svIdx].sizes = [...localUnionSizes]; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }} className="text-[7px] font-black uppercase text-blue-600 bg-white px-1.5 py-0.5 rounded border border-blue-100 hover:bg-blue-50 transition-colors">All</button>
                                                      <button type="button" onClick={() => { const updated = { ...fieldData }; updated.variants![vIdx].sizeVariants![svIdx].sizes = []; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }} className="text-[7px] font-black uppercase text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50 transition-colors">None</button>
                                                    </div>
                                                  </div>
                                                  <div className="flex flex-wrap gap-1">
                                                    {localUnionSizes.map(sz => {
                                                      const isSzSel = sv.sizes.includes(sz);
                                                      return (
                                                        <button key={sz} type="button" onClick={() => { const updated = { ...fieldData }; const sVar = updated.variants![vIdx].sizeVariants![svIdx]; if (isSzSel) sVar.sizes = sVar.sizes.filter(s => s !== sz); else sVar.sizes.push(sz); setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }} className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-all ${isSzSel ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-blue-300 border border-blue-100 hover:bg-blue-50'}`}>{sz}</button>
                                                      );
                                                    })}
                                                  </div>
                                                </div>
                                                <ConsumptionInput 
                                                  type={sv.consumption_type}
                                                  value={sv.consumption_val}
                                                  onChange={(t, val) => { const updated = { ...fieldData }; updated.variants![vIdx].sizeVariants![svIdx] = { ...sv, consumption_type: t, consumption_val: val }; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }}
                                                  onClear={() => { const updated = { ...fieldData }; delete updated.variants![vIdx].sizeVariants![svIdx].consumption_type; delete updated.variants![vIdx].sizeVariants![svIdx].consumption_val; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }}
                                                />
                                              </div>

                                              <textarea 
                                                className="w-full border-2 border-white rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none bg-white min-h-[60px]"
                                                placeholder="Instructions for selected size pool..."
                                                value={sv.text}
                                                onChange={e => { const updated = { ...fieldData }; updated.variants![vIdx].sizeVariants![svIdx].text = e.target.value; setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }}
                                              />
                                              
                                              <div className="flex flex-wrap gap-2">
                                                {sv.attachments.map((a, aIdx) => (
                                                  <div key={aIdx} className="flex items-center gap-1 bg-white border border-blue-50 px-2 py-1 rounded text-[9px] font-black text-blue-700">{a.name} <button onClick={() => { const updated = { ...fieldData }; updated.variants![vIdx].sizeVariants![svIdx].attachments.splice(aIdx, 1); setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated })); }}><X size={10}/></button></div>
                                                ))}
                                                <label className="bg-white border-2 border-dashed border-blue-100 text-blue-300 px-3 py-1 rounded-lg text-[9px] font-black cursor-pointer hover:bg-blue-50 transition-all">+ File <input type="file" multiple className="hidden" onChange={async (e) => {
                                                  if (!e.target.files) return;
                                                  setIsUploading(true);
                                                  const newAtts = [];
                                                  const files = Array.from(e.target.files) as File[];
                                                  for (const file of files) {
                                                    const url = await uploadOrderAttachment(file);
                                                    if (url) newAtts.push({ name: file.name, url, type: file.type.startsWith('image/') ? 'image' : 'document' });
                                                  }
                                                  const updated = { ...fieldData };
                                                  updated.variants![vIdx].sizeVariants![svIdx].attachments = [...(updated.variants![vIdx].sizeVariants![svIdx].attachments || []), ...newAtts];
                                                  setBulkFieldValues((prev: any) => ({ ...prev, [fieldKey]: updated }));
                                                  setIsUploading(false);
                                                }}/></label>
                                              </div>
                                            </div>
                                          ))}
                                          <button type="button" onClick={() => handleAddSizeGroup(fieldKey, vIdx)} className="w-full py-3 border-2 border-dashed border-blue-100 text-blue-300 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-blue-50">+ Add Size Sub-Split</button>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  <button type="button" onClick={() => handleSplitColor(fieldKey)} className="w-full py-5 border-4 border-dashed border-slate-100 text-slate-300 text-[11px] font-black uppercase tracking-[0.2em] rounded-3xl hover:border-indigo-200 transition-all">+ Add Bulk Color Group Variant</button>
                                </div>
                              )}
                           </div>
                         )}
                      </div>
                    );
                  })}
                </div>
             </div>
           ))}
        </div>

        <div className="p-8 border-t bg-white flex justify-between items-center shadow-2xl shrink-0">
          <button type="button" onClick={onClose} className="px-10 py-4 font-black text-slate-400 hover:text-slate-600 uppercase text-xs">Cancel</button>
          <button 
            onClick={handleEnhancedExecute} 
            disabled={isUploading}
            className="px-12 py-4 bg-orange-600 text-white rounded-2xl font-black shadow-2xl shadow-orange-200 flex items-center gap-3 active:scale-95 disabled:opacity-50 uppercase text-xs"
          >
            {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Save size={20}/>} Sync Selected Blueprint Fields
          </button>
        </div>
      </div>
    </div>
  );
};