
import React, { useState, useEffect } from 'react';
import { Order, OrderStatus, SizeBreakdown, Style, ConsumptionType, Attachment, normalizeSize, getSizeKeyFromLabel, getStyleMainImage, MaterialProcurement, MaterialStage, MATERIAL_STAGE_ORDER, MATERIAL_STAGE_LABEL, procurementStageQty } from '../../types';
import { X, ImageIcon, FileText, Download, Paperclip, Printer, Box, Calculator, Layers, PackageCheck } from 'lucide-react';
import { fetchStyleByNumber, fetchProcurements } from '../../services/db';

interface RequirementDetail {
  label: string;
  count: number;
  calc: number;
  text: string;
  attachments: Attachment[];
}

interface DetailedRequirement {
  name: string;
  total: number;
  breakdown: RequirementDetail[];
}

interface OrderDetailsModalProps {
  order: Order;
  useNumericSizes: boolean;
  onToggleSizeFormat: () => void;
  onClose: () => void;
  onPrint: () => void;
  onPrintMaterials: () => void;
}

export const OrderDetailsModal: React.FC<OrderDetailsModalProps> = ({
  order,
  useNumericSizes,
  onClose,
  onPrint,
  onPrintMaterials
}) => {
  const [linkedStyle, setLinkedStyle] = useState<Style | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'materials'>('details');
  const [procs, setProcs] = useState<MaterialProcurement[]>([]);
  const [procsLoading, setProcsLoading] = useState(true);

  useEffect(() => {
    const styleRefPart = order.style_number.split(' - ')[0].trim();
    if (styleRefPart) {
      fetchStyleByNumber(styleRefPart).then(setLinkedStyle);
    }
  }, [order.style_number]);

  useEffect(() => {
    let active = true;
    setProcsLoading(true);
    fetchProcurements()
      .then((all) => { if (active) setProcs(all.filter((p) => p.order_id === order.id)); })
      .finally(() => { if (active) setProcsLoading(false); });
    return () => { active = false; };
  }, [order.id]);

  const sizeLabels = order.size_sequence && order.size_sequence.length > 0 
    ? order.size_sequence 
    : (useNumericSizes ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL']);

  const getRowTotal = (row: SizeBreakdown) => {
    let total = 0;
    sizeLabels.forEach(label => {
      const key = getSizeKeyFromLabel(label, useNumericSizes ? 'numeric' : 'standard');
      total += (row[key] || 0);
    });
    return total;
  };

  const calculateRequirementValue = (qty: number, type: ConsumptionType, val: number) => {
    if (!val) return 0;
    return type === 'items_per_pc' ? qty * val : qty / val;
  };

  const getDetailedRequirements = (): DetailedRequirement[] => {
    if (!linkedStyle || !order.size_breakdown) return [];
    
    const detailedReqs: DetailedRequirement[] = [];
    const format = order.size_format || 'standard';

    for (const catName in linkedStyle.tech_pack) {
      for (const fieldName in linkedStyle.tech_pack[catName]) {
        const item = linkedStyle.tech_pack[catName][fieldName];
        const req: DetailedRequirement = { name: fieldName, total: 0, breakdown: [] };

        if (item.variants) {
          for (const variant of item.variants) {
            const matchingRows = order.size_breakdown.filter(r => variant.colors.includes(r.color));
            if (matchingRows.length === 0) continue;

            if (variant.sizeVariants) {
              for (const sv of variant.sizeVariants) {
                const svLabels = sv.sizes.map(s => normalizeSize(s));
                const qty = matchingRows.reduce((sum, row) => {
                  let rowSum = 0;
                  sizeLabels.forEach(label => {
                    if (svLabels.includes(normalizeSize(label))) {
                      const key = getSizeKeyFromLabel(label, format);
                      rowSum += (row[key] || 0);
                    }
                  });
                  return sum + rowSum;
                }, 0);
                
                if (qty > 0) {
                  const rType = sv.consumption_type || variant.consumption_type || item.consumption_type || 'items_per_pc';
                  const rVal = sv.consumption_val !== undefined ? sv.consumption_val : (variant.consumption_val !== undefined ? variant.consumption_val : (item.consumption_val || 0));
                  const calc = calculateRequirementValue(qty, rType, rVal);
                  
                  req.breakdown.push({
                    label: `${variant.colors.join('/')} - ${sv.sizes.join('/')}`,
                    count: qty,
                    calc: Math.ceil(calc * 100) / 100,
                    text: sv.text || variant.text || item.text,
                    attachments: sv.attachments.length > 0 ? sv.attachments : (variant.attachments.length > 0 ? variant.attachments : item.attachments)
                  });
                  req.total += calc;
                }
              }
            } else if (variant.consumption_type) {
              const qty = matchingRows.reduce((sum, row) => sum + getRowTotal(row), 0);
              const calc = calculateRequirementValue(qty, variant.consumption_type, variant.consumption_val || 0);
              req.breakdown.push({
                label: `Color: ${variant.colors.join('/')}`,
                count: qty,
                calc: Math.ceil(calc * 100) / 100,
                text: variant.text || item.text,
                attachments: variant.attachments.length > 0 ? variant.attachments : item.attachments
              });
              req.total += calc;
            }
          }
        } else if (item.consumption_type) {
          const calc = calculateRequirementValue(order.quantity, item.consumption_type, item.consumption_val || 0);
          req.breakdown.push({
            label: "Global Requirement",
            count: order.quantity,
            calc: Math.ceil(calc * 100) / 100,
            text: item.text,
            attachments: item.attachments
          });
          req.total = calc;
        }

        if (req.total > 0) {
          req.total = Math.ceil(req.total * 100) / 100;
          detailedReqs.push(req);
        }
      }
    }
    return detailedReqs;
  };

  const renderDetailCell = (rowIdx: number, label: string) => {
    const plannedRow = order.size_breakdown?.[rowIdx];
    const actualRow = order.completion_breakdown?.[rowIdx];
    const key = getSizeKeyFromLabel(label, useNumericSizes ? 'numeric' : 'standard');
    const plannedVal = plannedRow ? (plannedRow[key] || 0) : 0;

    if (order.status !== OrderStatus.COMPLETED || !actualRow) {
      return <span className="text-slate-600 font-medium">{plannedVal}</span>;
    }

    const actualVal = actualRow[key] || 0;
    const isMismatch = actualVal !== plannedVal;

    return (
      <div className="flex flex-col items-center justify-center p-1 bg-slate-50 rounded border border-slate-100">
        <span className={`text-lg font-black ${isMismatch ? 'text-indigo-700' : 'text-slate-900'}`}>
          {actualVal}
        </span>
        <span className="text-[10px] font-bold text-slate-400 border-t border-slate-200 w-full text-center mt-0.5 pt-0.5">
          Plan: {plannedVal}
        </span>
      </div>
    );
  };

  const detailedReqs = getDetailedRequirements();

  // Instruction text entered per tech-pack item, keyed by field/material name.
  const itemTextByName: Record<string, string> = {};
  if (linkedStyle?.tech_pack) {
    for (const cat in linkedStyle.tech_pack) {
      if (cat === '__poster__' || cat === '__custom__') continue;
      for (const f in linkedStyle.tech_pack[cat]) {
        const t = (linkedStyle.tech_pack[cat] as any)[f]?.text;
        if (t && !itemTextByName[f]) itemTextByName[f] = String(t);
      }
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden max-h-[95vh] flex flex-col animate-scale-up border border-slate-200">
        <div className="p-6 border-b flex justify-between items-center bg-slate-50">
          <div>
            <h3 className="text-2xl font-black text-slate-800 tracking-tight">{order.order_no}</h3>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Production Execution Details</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={28} /></button>
        </div>
        <div className="px-6 pt-3 bg-slate-50 border-b flex gap-1">
          {([['details', 'Execution Details'], ['materials', `Items Requested${procs.length ? ` (${procs.length})` : ''}`]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-t-lg border-b-2 transition-colors ${activeTab === id ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {activeTab === 'materials' ? (
            <MaterialsRequestedPanel procs={procs} loading={procsLoading} />
          ) : (
          <>
          {getStyleMainImage(linkedStyle) && (
            <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="w-24 h-24 rounded-xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center shrink-0">
                <img src={getStyleMainImage(linkedStyle)} alt={order.style_number} className="w-full h-full object-contain" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Style Preview</div>
                <div className="text-lg font-black text-slate-800 truncate">{order.style_number}</div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 shadow-sm">
              <span className="block text-slate-400 text-[10px] uppercase font-black tracking-widest mb-1">Style Number</span>
              <span className="text-lg font-black text-slate-800">{order.style_number}</span>
            </div>
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 shadow-sm">
              <span className="block text-slate-400 text-[10px] uppercase font-black tracking-widest mb-1">Delivery Date</span>
              <span className="text-lg font-black text-slate-800">{order.target_delivery_date}</span>
            </div>
            <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100 shadow-sm">
              <span className="block text-indigo-400 text-[10px] uppercase font-black tracking-widest mb-1 flex items-center gap-1"><Box size={12}/> Planned Boxes</span>
              <span className="text-xl font-black text-indigo-800">{order.box_count || '---'}</span>
            </div>
            {order.status === OrderStatus.COMPLETED && (
               <div className="p-4 bg-green-50 rounded-xl border border-green-100 shadow-sm animate-fade-in">
                <span className="block text-green-500 text-[10px] uppercase font-black tracking-widest mb-1 flex items-center gap-1"><Box size={12}/> Actual Packed</span>
                <span className="text-xl font-black text-green-800">{order.actual_box_count}</span>
              </div>
            )}
          </div>

          {detailedReqs.length > 0 && (
            <div className="space-y-4 animate-fade-in">
              <div className="p-4 bg-indigo-600 text-white rounded-t-2xl flex items-center justify-between">
                <h4 className="font-black uppercase tracking-[0.1em] text-xs flex items-center gap-2"><Calculator size={16}/> Segmented Material Requirements</h4>
                <span className="text-[10px] font-bold opacity-70">SYNCED FROM MASTER TECH-PACK</span>
              </div>
              <div className="space-y-4">
                {detailedReqs.map((req, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-indigo-100 overflow-hidden shadow-sm">
                    <div className="px-5 py-3 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                       <span className="font-black text-indigo-900 text-sm">{req.name}</span>
                       <span className="font-black text-indigo-700">Total: {req.total}</span>
                    </div>
                    {itemTextByName[req.name] && (
                      <div className="px-5 py-2.5 bg-white border-b border-indigo-50">
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Instructions</span>
                        <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">{itemTextByName[req.name]}</p>
                      </div>
                    )}
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {req.breakdown.map((b, idx) => (
                        <div key={idx} className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                           <div className="flex justify-between items-center">
                              <span className="text-[9px] font-black text-slate-500 uppercase">{b.label}</span>
                              <span className="text-sm font-black text-indigo-600">{b.calc} Req.</span>
                           </div>
                           <p className="text-xs text-slate-600 font-medium italic">"{b.text || 'No segments notes.'}"</p>
                           {b.attachments.length > 0 && (
                             <div className="flex flex-wrap gap-2 mt-2">
                                {b.attachments.map((att, attIdx) => (
                                  <a key={attIdx} href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2 py-1 bg-white border rounded text-[9px] font-bold text-slate-500 hover:text-indigo-600 hover:border-indigo-200 transition-all">
                                    {att.type === 'image' ? <ImageIcon size={10}/> : <FileText size={10}/>} {att.name}
                                  </a>
                                ))}
                             </div>
                           )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex justify-between items-center mb-4">
              <h4 className="font-black text-slate-700 uppercase tracking-tight text-lg">
                Production Matrix
                {order.status === OrderStatus.COMPLETED && <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full ml-3 border border-indigo-100 uppercase tracking-widest">Actual / Planned</span>}
              </h4>
            </div>
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-md overflow-x-auto">
              <table className="w-full text-center text-sm border-collapse min-w-max">
                <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[10px] tracking-widest border-b">
                  <tr>
                    <th className="p-4 text-left border-r">Color Variant</th>
                    {sizeLabels.map(h => <th key={h} className="p-4 border-r">{h}</th>)}
                    <th className="p-4 font-black bg-slate-100">Row Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {order.size_breakdown?.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-4 text-left font-black text-slate-700 border-r">{row.color}</td>
                      {sizeLabels.map(label => (
                         <td key={label} className="p-4 border-r">{renderDetailCell(idx, label)}</td>
                      ))}
                      <td className="p-4 font-black bg-slate-50/50 text-slate-800 tabular-nums">{getRowTotal(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-6 bg-slate-50/50 rounded-2xl border border-slate-200 shadow-inner">
              <h4 className="font-black text-slate-400 mb-4 uppercase tracking-widest text-[10px]">Production Instructions</h4>
              <p className="text-base text-slate-600 font-medium whitespace-pre-wrap leading-relaxed">{order.description || "No specific instructions provided."}</p>
            </div>
            <div className="p-6 bg-indigo-50/30 rounded-2xl border border-indigo-100 shadow-inner">
              <h4 className="font-black text-indigo-400 mb-4 uppercase tracking-widest text-[10px] flex items-center gap-2">
                <Paperclip size={14}/> Technical Reference Files
              </h4>
              <div className="space-y-3">
                {order.attachments && order.attachments.length > 0 ? (
                  order.attachments.map((att, i) => (
                    <a key={i} href={att.url} target="_blank" rel="noreferrer" className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200 hover:shadow-lg transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                          {att.type === 'image' ? <ImageIcon size={20} /> : <FileText size={20} />}
                        </div>
                        <span className="text-sm font-bold text-slate-700 truncate max-w-[200px]">{att.name}</span>
                      </div>
                      <Download size={18} className="text-slate-300 group-hover:text-indigo-600 transition-colors" />
                    </a>
                  ))
                ) : (
                  <div className="text-center py-10 text-slate-300">
                    <Paperclip size={32} className="mx-auto opacity-20 mb-2" />
                    <p className="text-[10px] uppercase font-black tracking-widest opacity-60">No documents attached</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          </>
          )}
        </div>
        <div className="p-6 border-t bg-slate-50 text-right flex justify-between items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.03)]">
          <button onClick={onPrintMaterials} className="px-6 py-3 bg-white text-indigo-600 border border-indigo-200 rounded-xl font-bold hover:bg-indigo-50 flex items-center gap-2 transition-all active:scale-95 uppercase tracking-widest text-[10px]">
            <Calculator size={16} /> Print Material Forecast
          </button>
          <div className="flex gap-4">
            <button onClick={onPrint} className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black hover:bg-indigo-700 shadow-xl shadow-indigo-200 flex items-center gap-2 transition-all active:scale-95 uppercase tracking-widest text-xs">
              <Printer size={18} /> Print Job Sheet
            </button>
            <button onClick={onClose} className="bg-slate-800 text-white px-10 py-3 rounded-xl font-black hover:bg-slate-700 transition-all active:scale-95 uppercase tracking-widest text-xs">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Items Requested tab: every material requested for this order + status ---
const STAGE_DOT: Record<MaterialStage, string> = {
  [MaterialStage.REQUESTED]: 'bg-slate-400',
  [MaterialStage.ORDERED]: 'bg-amber-500',
  [MaterialStage.RECEIVED]: 'bg-blue-500',
  [MaterialStage.RELEASED]: 'bg-emerald-500',
};

const procDominantStage = (p: MaterialProcurement): MaterialStage => {
  // The furthest stage that still holds quantity = the line's headline status.
  let stage: MaterialStage = MaterialStage.REQUESTED;
  MATERIAL_STAGE_ORDER.forEach((s) => { if (procurementStageQty(p, s) > 0) stage = s; });
  return stage;
};

const MaterialsRequestedPanel: React.FC<{ procs: MaterialProcurement[]; loading: boolean }> = ({ procs, loading }) => {
  if (loading) {
    return <div className="text-center py-16 text-slate-400 text-sm font-bold uppercase tracking-widest">Loading materials…</div>;
  }
  if (!procs.length) {
    return (
      <div className="text-center py-16 text-slate-300">
        <Layers size={36} className="mx-auto opacity-20 mb-3" />
        <p className="text-[11px] uppercase font-black tracking-widest opacity-70">No materials requested for this order yet</p>
        <p className="text-xs text-slate-400 mt-2">Material requisitions raised for this order will appear here with their live status.</p>
      </div>
    );
  }
  const totalReleased = procs.reduce((a, p) => a + procurementStageQty(p, MaterialStage.RELEASED), 0);
  const fullyIssued = procs.filter((p) => procurementStageQty(p, MaterialStage.RELEASED) >= p.total_quantity).length;
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Material Lines</div>
          <div className="text-2xl font-black text-slate-800">{procs.length}</div>
        </div>
        <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
          <div className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Fully Issued</div>
          <div className="text-2xl font-black text-emerald-700">{fullyIssued}/{procs.length}</div>
        </div>
        <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
          <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Released Units</div>
          <div className="text-2xl font-black text-indigo-700">{totalReleased.toLocaleString()}</div>
        </div>
      </div>

      <div className="space-y-3">
        {procs.map((p) => {
          const headline = procDominantStage(p);
          const released = procurementStageQty(p, MaterialStage.RELEASED);
          const done = released >= p.total_quantity && p.total_quantity > 0;
          return (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60">
                <div className="min-w-0">
                  <div className="font-black text-slate-800 truncate">{p.material_name}</div>
                  <div className="text-[11px] text-slate-400 font-bold">
                    {p.total_quantity.toLocaleString()} {p.unit}{p.invoice_no ? ` · Inv ${p.invoice_no}` : ''}
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest text-white ${STAGE_DOT[headline]}`}>
                  {done && <PackageCheck size={12} />}{MATERIAL_STAGE_LABEL[headline]}
                </span>
              </div>
              <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {MATERIAL_STAGE_ORDER.map((s) => {
                  const q = procurementStageQty(p, s);
                  const pctVal = p.total_quantity ? Math.round((q / p.total_quantity) * 100) : 0;
                  return (
                    <div key={s} className={`p-2.5 rounded-lg border ${q > 0 ? 'border-slate-200 bg-slate-50' : 'border-slate-100 bg-white'}`}>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${STAGE_DOT[s]}`} />
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">{MATERIAL_STAGE_LABEL[s]}</span>
                      </div>
                      <div className="text-sm font-black text-slate-800 mt-1 tabular-nums">{q.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400 font-bold">{pctVal}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
