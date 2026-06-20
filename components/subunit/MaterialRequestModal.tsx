import React, { useState, useEffect, useMemo } from 'react';
import { Order, MaterialRequest, SizeBreakdown, Style, ConsumptionType, Attachment } from '../../types';
import { X, Trash2, Calculator, ArrowLeftRight, Check, Plus, Paperclip, Files, Loader2, Zap, Info, FileText } from 'lucide-react';
import { uploadOrderAttachment, createMaterialRequest, updateMaterialRequest, fetchStyleByNumber, createProcurement, notifyMaterialRequisition } from '../../services/db';
import { MaterialStage } from '../../types';

interface MaterialRow {
  id: number;
  name: string;
  qtyPerPc: number;
  targetPcs: number;
  targetLabel: string;
  requestQty: number;
  unit: string;
  files: File[];
}

interface ForecastedItem {
  id: string;
  name: string;
  label: string;
  calc: number;
  unit: string;
  text: string;
  attachments: Attachment[];
  isSelected: boolean;
}

interface MaterialRequestModalProps {
  orderId: string;
  orderNo: string;
  orders: Order[];
  onClose: () => void;
  isEditingRequest: { id: string; originalData: MaterialRequest } | null;
  useNumericSizes: boolean;
  onRefresh: () => void;
}

export const MaterialRequestModal: React.FC<MaterialRequestModalProps> = ({
  orderId,
  orderNo,
  orders,
  onClose,
  isEditingRequest,
  useNumericSizes,
  onRefresh
}) => {
  const order = orders.find(o => o.id === orderId);
  const initialQty = order ? order.quantity : 0;
  
  const [reqTab, setReqTab] = useState<'direct' | 'pcs' | 'forecast'>(isEditingRequest ? 'direct' : 'forecast');
  const [linkedStyle, setLinkedStyle] = useState<Style | null>(null);
  const [isStyleLoading, setIsStyleLoading] = useState(false);
  
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>(
    isEditingRequest 
      ? [{ id: 1, name: isEditingRequest.originalData.material_content, qtyPerPc: 0, targetPcs: 0, targetLabel: '', requestQty: isEditingRequest.originalData.quantity_requested, unit: isEditingRequest.originalData.unit, files: [] }]
      : [{ id: 1, name: '', qtyPerPc: 0, targetPcs: initialQty, targetLabel: `Full Order (${initialQty})`, requestQty: 0, unit: 'Nos', files: [] }]
  );
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [qtyFilterModal, setQtyFilterModal] = useState<{ isOpen: boolean, rowIndex: number | null }>({ isOpen: false, rowIndex: null });
  const [filterMode, setFilterMode] = useState<'matrix' | 'manual'>('matrix');
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [manualOverrideQty, setManualOverrideQty] = useState<number>(0);
  
  // Forecast specific state
  const [forecastItems, setForecastItems] = useState<ForecastedItem[]>([]);

  // Fetch Style and calculate forecast
  useEffect(() => {
    if (order?.style_number) {
      setIsStyleLoading(true);
      const styleRefPart = order.style_number.split(' - ')[0].trim();
      fetchStyleByNumber(styleRefPart).then(s => {
        setLinkedStyle(s);
        setIsStyleLoading(false);
      });
    }
  }, [order?.style_number]);

  const calculateRequirementValue = (qty: number, type: ConsumptionType, val: number) => {
    if (!val) return 0;
    return type === 'items_per_pc' ? qty * val : qty / val;
  };

  const getHeaderLabels = () => useNumericSizes ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL'];
  const getRowTotal = (row: SizeBreakdown) => (row.s || 0) + (row.m || 0) + (row.l || 0) + (row.xl || 0) + (row.xxl || 0) + (row.xxxl || 0);

  // Generate Forecast Items when linkedStyle or Order changes
  useEffect(() => {
    if (!linkedStyle || !order?.size_breakdown) return;
    
    const items: ForecastedItem[] = [];
    const sizeKeys = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'] as const;
    const sizeLabels = getHeaderLabels();

    for (const catName in linkedStyle.tech_pack) {
      for (const fieldName in linkedStyle.tech_pack[catName]) {
        const item = linkedStyle.tech_pack[catName][fieldName];

        if (item.variants) {
          for (const variant of item.variants) {
            const matchingRows = order.size_breakdown.filter(r => variant.colors.includes(r.color));
            if (matchingRows.length === 0) continue;

            if (variant.sizeVariants) {
              for (const sv of variant.sizeVariants) {
                const targetKeys = sizeKeys.filter((_, i) => sv.sizes.includes(sizeLabels[i]));
                const qty = matchingRows.reduce((sum, row) => sum + targetKeys.reduce((s, k) => s + (row[k] || 0), 0), 0);
                
                if (qty > 0) {
                  const rType = sv.consumption_type || variant.consumption_type || item.consumption_type || 'items_per_pc';
                  const rVal = sv.consumption_val !== undefined ? sv.consumption_val : (variant.consumption_val !== undefined ? variant.consumption_val : (item.consumption_val || 0));
                  const calc = calculateRequirementValue(qty, rType, rVal);
                  
                  items.push({
                    id: `${fieldName}-${variant.colors.join('')}-${sv.sizes.join('')}`,
                    name: fieldName,
                    label: `${variant.colors.join('/')} - ${sv.sizes.join('/')}`,
                    calc: Math.ceil(calc * 100) / 100,
                    unit: 'Nos', // Default to Nos, can be enhanced to pull from techpack if added later
                    text: sv.text || variant.text || item.text,
                    attachments: sv.attachments.length > 0 ? sv.attachments : (variant.attachments.length > 0 ? variant.attachments : item.attachments),
                    isSelected: false
                  });
                }
              }
            } else if (variant.consumption_type) {
              const qty = matchingRows.reduce((sum, row) => sum + getRowTotal(row), 0);
              const calc = calculateRequirementValue(qty, variant.consumption_type, variant.consumption_val || 0);
              items.push({
                id: `${fieldName}-${variant.colors.join('')}`,
                name: fieldName,
                label: `Color: ${variant.colors.join('/')}`,
                calc: Math.ceil(calc * 100) / 100,
                unit: 'Nos',
                text: variant.text || item.text,
                attachments: variant.attachments.length > 0 ? variant.attachments : item.attachments,
                isSelected: false
              });
            }
          }
        } else if (item.consumption_type) {
          const calc = calculateRequirementValue(order.quantity, item.consumption_type, item.consumption_val || 0);
          items.push({
            id: `${fieldName}-global`,
            name: fieldName,
            label: "Global Requirement",
            calc: Math.ceil(calc * 100) / 100,
            unit: 'Nos',
            text: item.text,
            attachments: item.attachments,
            isSelected: false
          });
        }
      }
    }
    setForecastItems(items);
  }, [linkedStyle, order]);

  const handleRowChange = (id: number, field: keyof MaterialRow, value: any) => {
    setMaterialRows(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const addRow = () => {
    setMaterialRows(prev => [...prev, { id: Date.now(), name: '', qtyPerPc: 0, targetPcs: initialQty, targetLabel: `Full Order (${initialQty})`, requestQty: 0, unit: 'Nos', files: [] }]);
  };

  const removeRow = (id: number) => {
    setMaterialRows(prev => prev.filter(row => row.id !== id));
  };

  const calculateSelection = () => {
    if (!order || !order.size_breakdown) return 0;
    let total = 0;
    order.size_breakdown.forEach((row, rIdx) => {
      const sizeKeys: (keyof SizeBreakdown)[] = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'];
      sizeKeys.forEach(key => {
        if (selectedRows.includes(rIdx) || selectedCols.includes(key)) {
          total += (row[key] as number) || 0;
        }
      });
    });
    return total;
  };

  const handleConfirmQtyFilter = () => {
    if (qtyFilterModal.rowIndex === null) return;
    let finalQty = filterMode === 'manual' ? manualOverrideQty : calculateSelection();
    let label = filterMode === 'manual' ? `Manual (${finalQty})` : `Filter: ${selectedRows.length} Colors, ${selectedCols.length} Sizes`;
    const targetRowId = materialRows[qtyFilterModal.rowIndex].id;
    handleRowChange(targetRowId, 'targetPcs', finalQty);
    handleRowChange(targetRowId, 'targetLabel', label);
    setQtyFilterModal({ isOpen: false, rowIndex: null });
  };

  const toggleForecastSelection = (id: string) => {
    setForecastItems(prev => prev.map(item => item.id === id ? { ...item, isSelected: !item.isSelected } : item));
  };

  const handleSelectAllForecast = (select: boolean) => {
    setForecastItems(prev => prev.map(item => ({ ...item, isSelected: select })));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // The style reference used when pushing the requisition into the procurement pipeline.
    const styleRef = (linkedStyle?.style_number || order?.style_number?.split(' - ')[0] || '').trim();
    // Mirror a new requisition into the materials procurement pipeline (Requested stage)
    // so the Accessories/Materials desk sees it immediately. Never blocks the request.
    const pushToProcurement = async (material_name: string, quantity: number, unit: string) => {
      if (!styleRef || quantity <= 0) return;
      try {
        await createProcurement({
          order_id: orderId,
          style_number: styleRef,
          material_name,
          unit,
          total_quantity: quantity,
          startStage: MaterialStage.REQUESTED,
          note: `Auto-requisition from sub-unit (${orderNo})`,
        });
      } catch (err) {
        console.error('procurement sync failed', err);
      }
    };

    try {
      // Collect the freshly-raised items so the Materials desk gets ONE summary
      // alert (app inbox + Telegram) instead of one ping per line.
      const raisedItems: { name: string; quantity: number; unit: string }[] = [];
      if (reqTab === 'forecast') {
        const toSync = forecastItems.filter(i => i.isSelected);
        if (toSync.length === 0) {
          alert("No items selected for sync.");
          setIsSubmitting(false);
          return;
        }
        for (const item of toSync) {
          const content = `${item.name} (${item.label})`;
          await createMaterialRequest({ 
            order_id: orderId, 
            material_content: content, 
            quantity_requested: item.calc, 
            unit: item.unit, 
            attachments: item.attachments as any 
          });
          await pushToProcurement(content, item.calc, item.unit);
          raisedItems.push({ name: content, quantity: item.calc, unit: item.unit });
        }
      } else {
        for (const row of materialRows) {
          if (!row.name) continue;
          let finalQty = reqTab === 'direct' ? row.requestQty : (row.qtyPerPc * row.targetPcs);
          if (finalQty <= 0) continue;
          const attachments = [];
          for (const file of row.files) {
            const url = await uploadOrderAttachment(file);
            if (url) attachments.push({ name: file.name, url, type: file.type.startsWith('image/') ? 'image' : 'document' });
          }
          if (isEditingRequest) {
            await updateMaterialRequest(isEditingRequest.id, { material_content: row.name, quantity_requested: finalQty, unit: row.unit, attachments: attachments.length > 0 ? attachments as any : undefined });
          } else {
            await createMaterialRequest({ order_id: orderId, material_content: row.name, quantity_requested: finalQty, unit: row.unit, attachments: attachments as any });
            await pushToProcurement(row.name, finalQty, row.unit);
            raisedItems.push({ name: row.name, quantity: finalQty, unit: row.unit });
          }
        }
      }
      // Fire-and-forget notification for newly raised requisitions only.
      if (raisedItems.length) {
        notifyMaterialRequisition({
          orderNo,
          styleNumber: styleRef || undefined,
          items: raisedItems,
        }).catch(() => {});
      }
      onRefresh();
      onClose();
    } catch (err) {
      alert("Submission error. Check logs.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const matrixHeaders = useNumericSizes ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL'];
  const matrixKeys = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'];

  return (
    <div className="fixed inset-0 bg-black/70 bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh] animate-scale-up">
        <div className="p-6 border-b flex justify-between items-center bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
          <div>
            <h3 className="text-2xl font-black flex items-center gap-2">
              <Calculator size={28}/> Accessories Requisition
            </h3>
            <p className="text-blue-100 text-sm font-bold opacity-80 mt-1 uppercase tracking-widest">Order: {orderNo}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors"><X size={28} /></button>
        </div>

        <div className="p-8 space-y-6 overflow-y-auto flex-1 bg-slate-50/50">
          <div className="flex bg-slate-200 p-1.5 rounded-xl w-fit shadow-inner">
            <button 
              onClick={() => setReqTab('forecast')} 
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-black transition-all ${reqTab === 'forecast' ? 'bg-white text-indigo-600 shadow-lg scale-105' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Zap size={16}/> Forecast Sync
            </button>
            <button 
              onClick={() => setReqTab('pcs')} 
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-black transition-all ${reqTab === 'pcs' ? 'bg-white text-indigo-600 shadow-lg scale-105' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Calculator size={16}/> Calculator Mode
            </button>
            <button 
              onClick={() => setReqTab('direct')} 
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-black transition-all ${reqTab === 'direct' ? 'bg-white text-indigo-600 shadow-lg scale-105' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Files size={16}/> Direct Entry
            </button>
          </div>

          {reqTab === 'forecast' ? (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center gap-3">
                 <Info className="text-indigo-500" size={20}/>
                 <p className="text-xs font-bold text-indigo-800">Below are requirements pre-calculated from the technical blueprint linked to this style. Select items to push them to the Materials Requisition queue.</p>
              </div>

              {isStyleLoading ? (
                <div className="py-20 text-center flex flex-col items-center">
                   <Loader2 size={40} className="animate-spin text-indigo-600 mb-4"/>
                   <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Syncing with Style Database...</p>
                </div>
              ) : !linkedStyle ? (
                <div className="py-20 text-center bg-white border border-dashed rounded-3xl">
                   <X size={48} className="mx-auto text-slate-200 mb-2"/>
                   <p className="text-slate-400 font-bold">No technical blueprint found for this style.</p>
                   <p className="text-xs text-slate-300 mt-1">Please ensure the style exists in the Style DB to use Forecast Sync.</p>
                </div>
              ) : forecastItems.length === 0 ? (
                <div className="py-20 text-center bg-white border border-dashed rounded-3xl">
                   <Zap size={48} className="mx-auto text-slate-200 mb-2"/>
                   <p className="text-slate-400 font-bold">No forecasted material items found in the blueprint.</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
                  <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Forecast Analysis</span>
                    <div className="flex gap-2">
                       <button onClick={() => handleSelectAllForecast(true)} className="text-[9px] font-black text-indigo-600 hover:underline uppercase">Select All</button>
                       <button onClick={() => handleSelectAllForecast(false)} className="text-[9px] font-black text-slate-400 hover:underline uppercase">Clear All</button>
                    </div>
                  </div>
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[10px] tracking-widest border-b">
                      <tr>
                        <th className="p-4 w-12"></th>
                        <th className="p-4">Material / Item</th>
                        <th className="p-4">Scope / Variant</th>
                        <th className="p-4 text-center">Calculated Req.</th>
                        <th className="p-4">Reference Docs</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {forecastItems.map((item) => (
                        <tr key={item.id} className={`group hover:bg-slate-50/80 transition-colors cursor-pointer ${item.isSelected ? 'bg-indigo-50/50' : ''}`} onClick={() => toggleForecastSelection(item.id)}>
                          <td className="p-4" onClick={e => e.stopPropagation()}>
                            <input 
                              type="checkbox" 
                              checked={item.isSelected} 
                              onChange={() => toggleForecastSelection(item.id)}
                              className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="p-4">
                            <span className="font-black text-slate-800">{item.name}</span>
                            {item.text && (
                              <p className="mt-1 text-xs text-slate-500 font-medium whitespace-pre-wrap max-w-xs">{item.text}</p>
                            )}
                          </td>
                          <td className="p-4">
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full uppercase tracking-tighter">{item.label}</span>
                          </td>
                          <td className="p-4 text-center">
                            <span className="font-black text-indigo-600 text-lg">{item.calc}</span>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-wrap gap-1.5">
                              {item.attachments.map((att, idx) => (
                                att.type === 'image' ? (
                                  <a
                                    key={idx}
                                    href={att.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block w-12 h-12 rounded-lg overflow-hidden border border-slate-200 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 transition-all shadow-sm bg-slate-50"
                                    title={att.name}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                                  </a>
                                ) : (
                                  <a
                                    key={idx}
                                    href={att.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="w-12 h-12 bg-slate-100 hover:bg-indigo-100 rounded-lg border border-slate-200 hover:border-indigo-300 transition-all shadow-sm flex items-center justify-center group/icon"
                                    title={att.name}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <FileText size={18} className="text-slate-400 group-hover/icon:text-indigo-600 transition-colors"/>
                                  </a>
                                )
                              ))}
                              {item.attachments.length === 0 && <span className="text-[10px] text-slate-300 italic">None</span>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden animate-fade-in">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[10px] tracking-widest border-b">
                  <tr>
                    <th className="p-5">Material Item</th>
                    {reqTab === 'pcs' && (
                      <>
                        <th className="p-5 text-center">Qty Per Pc</th>
                        <th className="p-5 text-center">Calculated For</th>
                      </>
                    )}
                    <th className="p-5 text-center">Total Required</th>
                    <th className="p-5 text-center">Unit</th>
                    <th className="p-5">Reference Files</th>
                    <th className="p-5 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {materialRows.map((row, rIdx) => (
                    <tr key={row.id} className="group hover:bg-slate-50/50 transition-colors">
                      <td className="p-4">
                        <input 
                          className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 shadow-sm outline-none" 
                          placeholder="e.g. Zippers, Buttons, Thread"
                          value={row.name} 
                          onChange={e => handleRowChange(row.id, 'name', e.target.value)} 
                        />
                      </td>
                      {reqTab === 'pcs' && (
                        <>
                          <td className="p-4 w-32">
                            <input 
                              type="number" 
                              step="any" 
                              className="w-full border border-slate-200 rounded-xl px-3 py-3 bg-white text-slate-900 text-center font-black focus:ring-2 focus:ring-indigo-500 shadow-sm outline-none" 
                              value={row.qtyPerPc} 
                              onChange={e => handleRowChange(row.id, 'qtyPerPc', parseFloat(e.target.value) || 0)} 
                            />
                          </td>
                          <td className="p-4">
                            <button 
                              type="button" 
                              onClick={() => setQtyFilterModal({ isOpen: true, rowIndex: rIdx })} 
                              className="w-full bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 px-4 py-3 rounded-xl font-bold text-xs flex items-center justify-between transition-all"
                            >
                              <span className="truncate max-w-[120px]">{row.targetLabel}</span>
                              <ArrowLeftRight size={14} className="opacity-50"/>
                            </button>
                          </td>
                        </>
                      )}
                      <td className="p-4 w-32 text-center">
                        {reqTab === 'pcs' ? (
                          <div className="bg-slate-100 py-3 rounded-xl font-black text-lg text-indigo-700 shadow-inner">
                            {(row.qtyPerPc * row.targetPcs).toFixed(1)}
                          </div>
                        ) : (
                          <input 
                            type="number" 
                            className="w-full border border-slate-200 rounded-xl px-2 py-3 text-center bg-white text-slate-900 font-black focus:ring-2 focus:ring-indigo-500 shadow-sm" 
                            value={row.requestQty} 
                            onChange={e => handleRowChange(row.id, 'requestQty', parseFloat(e.target.value) || 0)} 
                          />
                        )}
                      </td>
                      <td className="p-4 w-28">
                        <select 
                          className="w-full border border-slate-200 rounded-xl px-2 py-3 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 shadow-sm outline-none" 
                          value={row.unit} 
                          onChange={e => handleRowChange(row.id, 'unit', e.target.value)}
                        >
                          <option value="Nos">Nos</option>
                          <option value="Meters">Meters</option>
                          <option value="Kgs">Kgs</option>
                          <option value="Rolls">Rolls</option>
                        </select>
                      </td>
                      <td className="p-4">
                        <label className="flex items-center gap-2 cursor-pointer group/file">
                          <div className="p-3 bg-slate-100 group-hover/file:bg-indigo-100 text-slate-400 group-hover/file:text-indigo-600 rounded-xl transition-all">
                            <Paperclip size={18}/>
                          </div>
                          <input 
                            type="file" 
                            multiple 
                            className="hidden" 
                            onChange={e => handleRowChange(row.id, 'files', e.target.files ? Array.from(e.target.files) : [])} 
                          />
                          <div className="flex flex-col">
                             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                               {row.files.length > 0 ? `${row.files.length} Files` : 'Upload'}
                             </span>
                             {row.files.length > 0 && <span className="text-[10px] text-indigo-500 font-bold truncate max-w-[80px]">{row.files[0].name}</span>}
                          </div>
                        </label>
                      </td>
                      <td className="p-4">
                        {materialRows.length > 1 && (
                          <button 
                            type="button" 
                            onClick={() => removeRow(row.id)}
                            className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          >
                            <Trash2 size={20} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button 
                type="button" 
                onClick={addRow} 
                className="w-full py-5 text-sm font-black text-indigo-600 hover:bg-indigo-50 border-t border-slate-100 flex items-center justify-center gap-2 transition-colors uppercase tracking-widest"
              >
                <Plus size={18}/> Add Line Item
              </button>
            </div>
          )}
        </div>

        <div className="p-6 border-t bg-slate-50 flex justify-end gap-4 shadow-inner">
          <button 
            type="button" 
            onClick={onClose} 
            className="px-8 py-3 font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors uppercase tracking-widest text-xs"
          >
            Discard
          </button>
          <button 
            type="button" 
            onClick={handleSubmit} 
            disabled={isSubmitting || isStyleLoading} 
            className="bg-indigo-600 text-white px-12 py-3 rounded-xl font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-95 flex items-center gap-2 uppercase tracking-widest text-xs"
          >
            {isSubmitting ? <><Loader2 size={20} className="animate-spin" /> Processing...</> : <><Check size={20}/> {reqTab === 'forecast' ? 'Sync Forecast to Materials' : 'Confirm Requisition'}</>}
          </button>
        </div>
      </div>

      {/* QUANTITY FILTER SUB-MODAL */}
      {qtyFilterModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/80 z-[60] flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-scale-up border border-slate-200">
            <div className="p-6 border-b bg-indigo-50 flex justify-between items-center">
              <div>
                <h4 className="font-black text-indigo-900 text-lg uppercase tracking-tight">Define Calculation Scope</h4>
                <p className="text-indigo-500 text-xs font-bold uppercase tracking-widest mt-0.5">Pick specific Colors or Sizes from Order Breakdown</p>
              </div>
              <button type="button" onClick={() => setQtyFilterModal({ isOpen: false, rowIndex: null })} className="text-indigo-400 hover:text-indigo-600 p-2"><X size={24}/></button>
            </div>
            
            <div className="p-8 space-y-8">
              <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl w-fit shadow-inner">
                <button 
                  type="button" 
                  onClick={() => setFilterMode('matrix')} 
                  className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${filterMode === 'matrix' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500'}`}
                >
                  Matrix Filter
                </button>
                <button 
                  type="button" 
                  onClick={() => setFilterMode('manual')} 
                  className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${filterMode === 'manual' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500'}`}
                >
                  Manual Input
                </button>
              </div>

              {filterMode === 'matrix' ? (
                <div className="space-y-4">
                  <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-center border-collapse">
                        <thead className="bg-slate-50 text-slate-400 font-black uppercase tracking-tighter">
                          <tr>
                            <th className="p-3 border-r w-12"><Check size={14} className="mx-auto"/></th>
                            <th className="p-3 border-r text-left w-32">Variant</th>
                            {matrixHeaders.map((h, i) => (
                              <th 
                                key={h} 
                                className={`p-3 cursor-pointer border-r hover:bg-indigo-100 transition-colors ${selectedCols.includes(matrixKeys[i]) ? 'bg-indigo-600 text-white' : ''}`} 
                                onClick={() => {
                                  const key = matrixKeys[i];
                                  setSelectedCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {order?.size_breakdown?.map((row, idx) => (
                            <tr key={idx} className={`${selectedRows.includes(idx) ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}`}>
                              <td className="p-3 border-r">
                                <input 
                                  type="checkbox" 
                                  className="w-4 h-4 rounded text-indigo-600"
                                  checked={selectedRows.includes(idx)} 
                                  onChange={() => setSelectedRows(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx])} 
                                />
                              </td>
                              <td className={`p-3 text-left font-black border-r ${selectedRows.includes(idx) ? 'text-indigo-700' : 'text-slate-700'}`}>
                                {row.color}
                              </td>
                              {matrixKeys.map(key => {
                                const isHighlighted = selectedRows.includes(idx) || selectedCols.includes(key);
                                return (
                                  <td key={key} className={`p-3 border-r tabular-nums font-bold ${isHighlighted ? 'text-indigo-600 bg-indigo-50/30' : 'text-slate-300 font-medium'}`}>
                                    {(row as any)[key]}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  
                  <div className="p-6 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl shadow-lg flex justify-between items-center text-white">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-70">Calculated Volume</span>
                      <h5 className="text-3xl font-black">{calculateSelection()} <span className="text-base opacity-70">Pieces</span></h5>
                    </div>
                    <div className="bg-white/20 p-3 rounded-xl border border-white/10 backdrop-blur-sm">
                       <Calculator size={32}/>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Total Target Pieces (Direct Count)</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      className="w-full border-2 border-slate-100 rounded-3xl p-8 text-6xl font-black bg-white text-indigo-600 focus:border-indigo-500 shadow-inner outline-none transition-all" 
                      value={manualOverrideQty} 
                      onChange={e => setManualOverrideQty(parseInt(e.target.value) || 0)} 
                    />
                    <div className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-300">
                      <Calculator size={48} />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 italic text-center">Use this for manual overrides where matrix breakdown is unavailable.</p>
                </div>
              )}
            </div>

            <div className="p-6 border-t bg-slate-50 flex justify-end gap-3">
              <button 
                type="button" 
                onClick={() => setQtyFilterModal({ isOpen: false, rowIndex: null })} 
                className="px-6 py-3 font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button 
                type="button" 
                onClick={handleConfirmQtyFilter} 
                className="px-10 py-3 bg-indigo-600 text-white rounded-xl font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all"
              >
                Apply Selection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};