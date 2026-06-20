
import React, { useState, useEffect } from 'react';
import { X, Pencil, Trash2, Printer, Save, Loader2, Clock, Paperclip, Box, Image as ImageIcon, FileText, Download, ArrowLeftRight, Upload, BookOpen, Calculator, ExternalLink, RefreshCcw } from 'lucide-react';
import { Order, Unit, OrderLog, SizeBreakdown, Attachment, OrderStatus, formatOrderNumber, Style, StyleTemplate, ConsumptionType, DetailedRequirement, normalizeSize, getSizeKeyFromLabel, getStyleMainImage } from '../../types';
import { fetchOrderLogs, updateOrderDetails, deleteOrder, triggerOrderEmail, uploadOrderAttachment, fetchStyleByNumber, fetchStyleTemplate, fetchStyles, calculateOrderForecast } from '../../services/db';
import { brandHeaderHtml, brandHeaderDualLogoHtml } from '../../services/brandAssets';

interface AdminOrderDetailsModalProps {
  order: Order;
  units: Unit[];
  onClose: () => void;
  onRefresh: () => void;
}

export const AdminOrderDetailsModal: React.FC<AdminOrderDetailsModalProps> = ({ order, units, onClose, onRefresh }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<Order>>({ ...order });
  const [modalLogs, setModalLogs] = useState<OrderLog[]>([]);
  const [useNumericSizes, setUseNumericSizes] = useState(order.size_format === 'numeric');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [linkedStyle, setLinkedStyle] = useState<Style | null>(null);
  const [availableStyles, setAvailableStyles] = useState<Style[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string>('');

  useEffect(() => {
    fetchOrderLogs(order.id).then(setModalLogs);
    fetchStyles().then(setAvailableStyles);
    
    const styleRefPart = order.style_number.split(' - ')[0].trim();
    if (styleRefPart) {
        fetchStyleByNumber(styleRefPart).then(s => {
            setLinkedStyle(s);
            if (s) setSelectedStyleId(s.id);
        });
    }
  }, [order.id, order.style_number]);

  const sizeLabels = editFormData.size_sequence && editFormData.size_sequence.length > 0 
    ? editFormData.size_sequence 
    : (useNumericSizes ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL']);

  const getRowTotal = (row: SizeBreakdown) => {
    let total = 0;
    sizeLabels.forEach(label => {
      const key = getSizeKeyFromLabel(label, useNumericSizes ? 'numeric' : 'standard');
      total += (row[key] || 0);
    });
    return total;
  };

  const getTotalQuantity = (bd: SizeBreakdown[]) => bd.reduce((acc, row) => acc + getRowTotal(row), 0);

  const handleStyleSelect = (styleId: string) => {
    setSelectedStyleId(styleId);
    const style = availableStyles.find(s => s.id === styleId);
    if (!style) return;
    
    // Autofill Logic: Reference = <style number> - <short description>
    const newStyleNum = `${style.style_number} - ${style.style_text}`;
    setEditFormData(prev => ({
      ...prev,
      style_number: newStyleNum
    }));
    
    setUseNumericSizes(style.size_type === 'number');
    setLinkedStyle(style);

    // Prompt to update color variants if they exist in the new style
    if (style.available_colors && style.available_colors.length > 0) {
      if (confirm("Would you like to reset the color breakdown based on the new style's colors? (Existing quantities will be lost)")) {
        const newBreakdown = style.available_colors
          .filter(c => c.trim() !== '')
          .map(color => {
            const row: SizeBreakdown = { color };
            return row;
          });
        setEditFormData(prev => ({ ...prev, size_breakdown: newBreakdown }));
      }
    }
  };

  const getDetailedRequirements = (): DetailedRequirement[] => {
    // If we are currently editing, recalculate dynamically based on form data
    if (isEditing && linkedStyle) {
      return calculateOrderForecast({ ...order, ...editFormData } as Order, linkedStyle);
    }
    // Otherwise, prefer the stored forecast from the database, fall back to calculation
    if (order.material_forecast && order.material_forecast.length > 0) {
      return order.material_forecast;
    }
    if (linkedStyle) {
      return calculateOrderForecast(order, linkedStyle);
    }
    return [];
  };

  const handleSave = async () => {
    setIsUploading(true);
    try {
      const newAttachments: Attachment[] = [];
      for (const file of selectedFiles) {
        const url = await uploadOrderAttachment(file);
        if (url) newAttachments.push({ name: file.name, url, type: file.type.startsWith('image/') ? 'image' : 'document' });
      }
      const finalAttachments = [...(editFormData.attachments || []), ...newAttachments];
      const finalQty = getTotalQuantity(editFormData.size_breakdown as SizeBreakdown[]);
      
      // Calculate final forecast before saving to ensure DB is in sync
      let finalForecast = order.material_forecast;
      if (linkedStyle) {
        finalForecast = calculateOrderForecast({ ...order, ...editFormData, quantity: finalQty } as Order, linkedStyle);
      }

      const result = await updateOrderDetails(order.id, { 
        ...editFormData, 
        quantity: finalQty, 
        attachments: finalAttachments, 
        size_format: useNumericSizes ? 'numeric' : 'standard',
        material_forecast: finalForecast
      });

      if (result.success) {
        await triggerOrderEmail(order.id, true);
        onRefresh();
        onClose();
      } else {
        alert("Error saving: " + result.error);
      }
    } catch (err: any) {
        alert("Exception: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handlePrintMaterialForecast = () => {
    const detailedReqs = getDetailedRequirements();
    if (detailedReqs.length === 0) return alert("No projected requirements found.");

    const formattedNo = formatOrderNumber(order);
    const win = window.open('', 'MaterialForecast', 'width=1000,height=800');
    if (win) {
      win.document.write(`
        <html><head><title>Forecast - ${formattedNo}</title>
        <style>
          body { font-family: sans-serif; padding: 30px; font-size: 11px; color: #1e293b; }
          .header { text-align: center; border-bottom: 3px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
          .brand { font-size: 22px; font-weight: 900; }
          .title { font-size: 14px; font-weight: bold; text-transform: uppercase; margin-top: 5px; color:#64748b; letter-spacing:1px; }
          .meta { margin-bottom: 20px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; background: #f8fafc; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; }
          .section { margin-bottom: 20px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; page-break-inside: avoid; }
          .section-header { background: #334155; color: #fff; padding: 8px 12px; font-weight: bold; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f1f5f9; text-transform: uppercase; font-size: 9px; color: #64748b; }
          .qty-val { font-weight: 900; color: #4f46e5; font-size: 13px; }
          .img-grid { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
          .img-grid img { height: 60px; border-radius: 3px; border: 1px solid #ddd; }
          .footer { margin-top: 30px; text-align: center; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
        </style>
        </head><body>
          <div class="header">
            ${brandHeaderHtml('Projected Material Requirements Forecast')}
          </div>
          <div class="meta">
            <div><strong>Order:</strong> ${formattedNo}</div>
            <div><strong>Style:</strong> ${isEditing ? editFormData.style_number : order.style_number}</div>
            <div><strong>Batch:</strong> ${isEditing ? getTotalQuantity(editFormData.size_breakdown as SizeBreakdown[]) : order.quantity} PCS</div>
            <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
          </div>
          ${detailedReqs.map(req => `
            <div class="section">
              <div class="section-header"><span>${req.name}</span><span style="background:rgba(255,255,255,0.2); padding:2px 8px; border-radius:4px;">TOTAL JOB REQ: ${req.total}</span></div>
              <table>
                <thead><tr><th>Segment Scope</th><th style="text-align:center">Base Qty</th><th style="text-align:right">Calculated Req.</th><th>Instructions & Visuals</th></tr></thead>
                <tbody>${req.breakdown.map(b => `
                  <tr>
                    <td><strong>${b.label}</strong></td>
                    <td style="text-align:center">${b.count}</td>
                    <td style="text-align:right" class="qty-val">${b.calc}</td>
                    <td>
                        <div style="font-weight:bold; margin-bottom:4px;">${b.text || '---'}</div>
                        <div class="img-grid">${b.attachments.filter(a => a.type === 'image').map(img => `<img src="${img.url}"/>`).join('')}</div>
                    </td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          `).join('')}
          <div class="footer">Document generated via Tintura SST MES. Estimates are for internal production planning only.</div>
          <script>window.print(); </script>
        </body></html>
      `);
      win.document.close();
    }
  };

  const handlePrint = async () => {
    let techPackHtml = '';
    let preProductionHtml = '';
    
    const activeStyleNumber = isEditing ? editFormData.style_number : order.style_number;
    const styleRefPart = activeStyleNumber!.split(' - ')[0].trim();
    if (styleRefPart) {
        const [style, template] = await Promise.all([ fetchStyleByNumber(styleRefPart), fetchStyleTemplate() ]);
        if (style && template) {
            const renderField = (f: string, catName: string) => {
                const item = style.tech_pack[catName]?.[f] || { text: 'N/A', attachments: [] };
                let contentHtml = '';
                if (item.variants) {
                  contentHtml = item.variants.map(v => {
                    let sizeHtml = '';
                    const vImgs = v.attachments.filter(a => a.type === 'image');
                    if (v.sizeVariants) {
                      sizeHtml = `<div style="margin-top:8px; display:grid; grid-template-columns:1fr; gap:6px;">${v.sizeVariants.map(sv => {
                        const svImgs = sv.attachments.filter(a => a.type === 'image');
                        return `
                        <div style="background:#fff; border:1px solid #ddd; border-left:3px solid #4f46e5; padding:8px; border-radius:4px; page-break-inside:avoid;">
                          <div style="font-size:9px; font-weight:bold; color:#4f46e5; margin-bottom:2px;">SIZES: ${sv.sizes.join(', ')}</div>
                          <div style="font-size:11px; font-weight:bold;">${sv.text || '---'}</div>
                          <div style="display:grid; grid-template-columns:${svImgs.length === 1 ? '1fr' : '1fr 1fr'}; gap:5px; margin-top:5px;">
                            ${svImgs.map(a => `<img src="${a.url}" style="width:100%; border-radius:2px; border:1px solid #ddd;"/>`).join('')}
                          </div>
                        </div>
                      `}).join('')}</div>`;
                    }
                    return `
                      <div style="border:1px solid #e2e8f0; padding:10px; border-radius:6px; margin-top:8px; background:#f8fafc; page-break-inside:avoid;">
                        <div style="margin-bottom:4px;">${v.colors.map(c => `<span style="background:#334155; color:#fff; font-size:8px; font-weight:bold; padding:1px 5px; border-radius:2px; margin-right:3px; text-transform:uppercase;">${c}</span>`).join('')}</div>
                        <div style="font-size:12px; font-weight:bold;">${v.text || '---'}</div>
                        <div style="display:grid; grid-template-columns:${vImgs.length === 1 ? '1fr' : '1fr 1fr'}; gap:5px; margin-top:5px;">
                          ${vImgs.map(a => `<img src="${a.url}" style="width:100%; border-radius:3px; border:1px solid #ddd;"/>`).join('')}
                        </div>
                        ${sizeHtml}
                      </div>`;
                  }).join('');
                } else {
                  const itemImgs = item.attachments.filter(a => a.type === 'image');
                  contentHtml = `
                    <div style="font-size:12px; background:#f8fafc; padding:10px; border-radius:6px; border:1px solid #e2e8f0; font-weight:bold;">
                      ${item.text || '---'}
                      <div style="display:grid; grid-template-columns:${itemImgs.length === 1 ? '1fr' : '1fr 1fr'}; gap:8px; margin-top:8px;">
                        ${itemImgs.map(a => `<img src="${a.url}" style="width:100%; border-radius:4px; border:1px solid #ddd;"/>`).join('')}
                      </div>
                    </div>`;
                }
                return `<div style="margin-bottom:12px; page-break-inside:avoid;"><div style="font-size:9px; font-weight:bold; color:#94a3b8; text-transform:uppercase; margin-bottom:5px;">${f}</div>${contentHtml}</div>`;
            };

            const preProdCat = template.config.find(c => c.name.toLowerCase().includes('pre production'));
            if (preProdCat) {
                preProductionHtml = `
                    <div style="page-break-before:always; margin-top:30px;">
                        <h3 style="background:#334155; color:#fff; padding:6px 12px; font-size:11px; text-transform:uppercase; border-radius:4px;">Pre-Production Requirements</h3>
                        <div style="padding:10px 0;">${preProdCat.fields.map(f => renderField(f, preProdCat.name)).join('')}</div>
                    </div>`;
            }

            techPackHtml = template.config.filter(c => 
              c.name !== "General Info" && 
              !c.name.toLowerCase().includes('pre production') && 
              !c.name.toLowerCase().includes('packing') &&
              !c.name.toLowerCase().includes('requirements during production')
            ).map(cat => {
                return `<div style="margin-top:20px; page-break-inside:avoid;"><h3 style="background:#f1f5f9; color:#334155; padding:6px 12px; font-size:11px; text-transform:uppercase; border-radius:4px; border-left:4px solid #334155;">${cat.name}</h3><div style="padding:5px 0;">${cat.fields.map(f => renderField(f, cat.name)).join('')}</div></div>`;
            }).join('');
        }
    }

    const formattedNo = formatOrderNumber(order);
    const keys = sizeLabels.map(l => getSizeKeyFromLabel(l, useNumericSizes ? 'numeric' : 'standard'));
    const activeBreakdown = (isEditing ? editFormData.size_breakdown : order.size_breakdown) || [];
    const breakdownRows = activeBreakdown.map(row => `<tr><td style="text-align:left; font-weight:bold; border: 1px solid #333;">${row.color}</td>${keys.map(k => `<td style="border: 1px solid #333;">${row[k] || 0}</td>`).join('')}<td style="font-weight:bold; background:#f1f5f9; border: 1px solid #333;">${getRowTotal(row)}</td></tr>`).join('');

    const activeAttachments = (isEditing ? editFormData.attachments : order.attachments) || [];
    const orderImgs = activeAttachments.filter(a => a.type === 'image');
    const attachmentGridStyle = `display:grid; grid-template-columns:${orderImgs.length === 1 ? '1fr' : '1fr 1fr'}; gap:10px; margin-top:10px;`;
    
    let orderDate = 'N/A';
    if (order.created_at) {
      const d = new Date(order.created_at);
      orderDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }

    const win = window.open('', 'OrderPrint', 'width=1100,height=850');
    if (win) {
        win.document.write(`<html><head><title>Job Sheet - ${formattedNo}</title>
        <style>
          body { font-family: sans-serif; padding: 30px; color: #1e293b; font-size: 10px; line-height: 1.3; }
          .header { text-align: center; border-bottom: 3.5px solid #000; padding-bottom: 12px; margin-bottom: 18px; }
          .brand { font-size: 28px; font-weight: 900; }
          .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 15px; }
          .box { padding: 8px 12px; border: 1.5px solid #1e293b; border-radius:6px; }
          .label { font-size: 7px; font-weight: bold; color: #64748b; text-transform: uppercase; margin-bottom:2px; display:block; }
          .value { font-size: 13px; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #1e293b; padding: 6px; text-align: center; }
          th { background: #f8fafc; font-weight: bold; font-size: 8px; text-transform:uppercase; }
          .section-title { font-size: 12px; font-weight: 900; border-bottom: 1.5px solid #1e293b; margin-top: 20px; margin-bottom: 8px; text-transform: uppercase; padding-bottom:2px; }
          .notes-box { padding: 10px 15px; border: 1.5px solid #1e293b; background: #f8fafc; border-radius: 6px; font-size: 11px; font-weight:bold; white-space: pre-wrap; }
        </style>
        </head><body>
          <div class="header">${brandHeaderDualLogoHtml('Job Execution Document')}</div>
          <div class="grid">
            <div class="box"><span class="label">Job ID</span><div class="value">${formattedNo}</div></div>
            <div class="box"><span class="label">Style</span><div class="value">${activeStyleNumber}</div></div>
            <div class="box"><span class="label">Batch Qty</span><div class="value">${isEditing ? getTotalQuantity(activeBreakdown) : order.quantity} PCS</div></div>
            <div class="box"><span class="label">Order Date</span><div class="value">${orderDate}</div></div>
            <div class="box"><span class="label">Target Date</span><div class="value">${isEditing ? editFormData.target_delivery_date : order.target_delivery_date}</div></div>
          </div>
          
          <div class="section-title">Color & Size Matrix</div>
          <table><thead><tr><th style="text-align:left; border:1px solid #333;">Variant</th>${sizeLabels.map(l => `<th style="border:1px solid #333;">${l}</th>`).join('')}<th style="border:1px solid #333;">Total</th></tr></thead><tbody>${breakdownRows}</tbody></table>
          
          <div class="section-title">Manufacturing Notes</div>
          <div class="notes-box">${isEditing ? editFormData.description : order.description || 'No notes provided.'}</div>

          ${orderImgs.length > 0 ? `
            <div class="section-title">Visual References</div>
            <div style="${attachmentGridStyle}">
              ${orderImgs.map(img => `<div style="border:1px solid #e2e8f0; padding:8px; text-align:center; background:#fff; page-break-inside:avoid;"><img src="${img.url}" style="width:100%; border-radius:4px;"/><div style="font-size:8px; margin-top:4px; font-weight:bold; color:#64748b;">${img.name}</div></div>`).join('')}
            </div>
          ` : ''}

          ${preProductionHtml}
          <div style="page-break-before: auto;">
            ${techPackHtml}
          </div>
          <script>window.onload = () => { window.print(); };</script>
        </body></html>`);
        win.document.close();
    }
  };

  const detailedReqs = getDetailedRequirements();

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[95vh] animate-scale-up border border-slate-200">
        <div className="p-6 border-b flex justify-between items-start bg-white">
          <div className="flex items-center gap-4">
            {getStyleMainImage(linkedStyle) && (
              <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                <img src={getStyleMainImage(linkedStyle)} alt={order.style_number} className="w-full h-full object-contain" />
              </div>
            )}
            <div>
              <h3 className="text-3xl font-black text-slate-800 tracking-tight">{formatOrderNumber(order)}</h3>
              {isEditing && <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mt-1">Editing Mode Active</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!isEditing && <button onClick={() => setIsEditing(true)} className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-5 py-2.5 rounded-xl text-sm font-black hover:bg-indigo-600 hover:text-white transition-all"><Pencil size={18} /> Modify Order</button>}
            <button onClick={onClose} className="text-slate-300 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full"><X size={32}/></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-slate-50/20">
          
          {isEditing && (
            <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 animate-fade-in space-y-6">
              <div className="flex flex-col md:flex-row items-center gap-6">
                <div className="flex items-center gap-3 shrink-0">
                  <div className="p-3 bg-white rounded-xl text-indigo-600 shadow-sm border border-indigo-50">
                    <BookOpen size={24}/>
                  </div>
                  <div>
                    <h4 className="font-black text-indigo-900 text-sm uppercase tracking-tight leading-none">Change Technical Style</h4>
                    <p className="text-indigo-400 text-[10px] font-bold uppercase tracking-widest mt-1">Link this order to a different blueprint</p>
                  </div>
                </div>
                <div className="flex-1 w-full">
                  <select 
                    className="w-full bg-white border-2 border-indigo-200 rounded-xl px-5 py-4 text-sm font-black text-indigo-700 outline-none focus:ring-4 focus:ring-indigo-100 cursor-pointer shadow-sm"
                    value={selectedStyleId}
                    onChange={e => handleStyleSelect(e.target.value)}
                  >
                    <option value="">-- No linked technical style --</option>
                    {availableStyles.map(s => (
                      <option key={s.id} value={s.id}>{s.style_number} - {s.style_text}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {!isEditing && (
            <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 flex items-center gap-3">
              <BookOpen size={20} className="text-indigo-600"/>
              <div>
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest leading-none">Style DB Synchronized</p>
                <p className="text-sm font-bold text-indigo-900 mt-1">Granular material forecasts calculated based on color and size specific ratios.</p>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="p-5 bg-white rounded-2xl border border-slate-100 shadow-sm">
                <span className="block text-[10px] text-slate-400 uppercase font-black mb-2">Reference Text</span>
                {isEditing ? (
                  <input 
                    className="w-full border rounded p-2 text-sm font-bold text-slate-800" 
                    value={editFormData.style_number} 
                    onChange={e => setEditFormData({...editFormData, style_number: e.target.value})}
                  />
                ) : (
                  <div className="text-sm font-black text-slate-800">{order.style_number}</div>
                )}
            </div>
            <div className="p-5 bg-white rounded-2xl border border-slate-100 shadow-sm">
              <span className="block text-[10px] text-slate-400 uppercase font-black mb-2">Volume</span>
              <div className="text-2xl font-black text-slate-800">{isEditing ? getTotalQuantity(editFormData.size_breakdown as SizeBreakdown[]) : order.quantity} PCS</div>
            </div>
            <div className="p-5 bg-white rounded-2xl border border-slate-100 shadow-sm">
              <span className="block text-[10px] text-slate-400 uppercase font-black mb-2">Delivery</span>
              {isEditing ? (
                <input type="date" className="w-full border rounded p-2 font-bold" value={editFormData.target_delivery_date} onChange={e => setEditFormData({...editFormData, target_delivery_date: e.target.value})}/>
              ) : (
                <div className="text-lg font-black">{order.target_delivery_date}</div>
              )}
            </div>
            <div className="p-5 bg-white rounded-2xl border border-slate-100 shadow-sm">
              <span className="block text-[10px] text-slate-400 uppercase font-black mb-2"><Box size={10}/> Planned Boxes</span>
              {isEditing ? (
                <input type="number" className="w-full border rounded p-2 font-bold" value={editFormData.box_count} onChange={e => setEditFormData({...editFormData, box_count: parseInt(e.target.value) || 0})}/>
              ) : (
                <div className="text-lg font-black">{order.box_count}</div>
              )}
            </div>
            <div className="p-5 bg-indigo-50 rounded-2xl border border-indigo-100 shadow-sm">
              <span className="block text-[10px] text-indigo-400 uppercase font-black mb-2">Facility Unit</span>
              {isEditing ? (
                <select className="w-full border rounded p-2 bg-white font-bold" value={editFormData.unit_id} onChange={e => setEditFormData({...editFormData, unit_id: parseInt(e.target.value)})}>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : (
                <div className="text-lg font-black text-indigo-900">{units.find(u => u.id === order.unit_id)?.name}</div>
              )}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-4">
              <h4 className="font-black text-slate-700 uppercase tracking-tight text-lg">Product breakdown matrix</h4>
              {isEditing && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setUseNumericSizes(!useNumericSizes)} className="text-[10px] bg-slate-100 px-4 py-2 rounded-xl border border-slate-200 font-black uppercase"><ArrowLeftRight size={14} className="inline mr-2"/> Switch Size Format</button>
                  <button type="button" onClick={() => setEditFormData({...editFormData, size_breakdown: [...(editFormData.size_breakdown || []), { color: '' }]})} className="text-[10px] bg-indigo-600 text-white px-4 py-2 rounded-xl font-black uppercase hover:bg-indigo-700 transition-all">+ Add Color</button>
                </div>
              )}
            </div>
            <div className="border border-slate-200 rounded-3xl overflow-hidden shadow-sm bg-white overflow-x-auto">
              <table className="w-full text-center text-sm border-collapse min-w-max">
                <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[10px] tracking-widest border-b">
                  <tr>
                    <th className="p-4 text-left border-r">Color Variant</th>
                    {sizeLabels.map(h => <th key={h} className="p-4 border-r">{h}</th>)}
                    <th className="p-4 bg-slate-100">Sum</th>
                    {isEditing && <th className="p-4 w-12"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(isEditing ? editFormData.size_breakdown : order.size_breakdown)?.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-4 text-left font-black text-slate-700 border-r min-w-[150px]">
                        {isEditing ? (
                          <input className="w-full border rounded p-1 font-bold text-sm" value={row.color} onChange={e => { const bd = [...(editFormData.size_breakdown || [])]; bd[idx].color = e.target.value; setEditFormData({...editFormData, size_breakdown: bd}); }}/>
                        ) : row.color}
                      </td>
                      {sizeLabels.map(label => {
                        const key = getSizeKeyFromLabel(label, useNumericSizes ? 'numeric' : 'standard');
                        return (
                          <td key={label} className="p-4 border-r w-20">
                            {isEditing ? (
                              <input type="number" className="w-16 border rounded p-1 text-center font-black" value={row[key] || ''} onChange={e => { const bd = [...(editFormData.size_breakdown || [])]; bd[idx][key] = parseInt(e.target.value) || 0; setEditFormData({...editFormData, size_breakdown: bd}); }}/>
                            ) : (row[key] || 0)}
                          </td>
                        );
                      })}
                      <td className="p-4 font-black text-slate-900 bg-slate-50/50 tabular-nums">{getRowTotal(row)}</td>
                      {isEditing && (
                        <td className="p-4">
                          <button onClick={() => setEditFormData({...editFormData, size_breakdown: (editFormData.size_breakdown || []).filter((_, i) => i !== idx)})} className="text-red-400 hover:text-red-600 transition-colors">
                            <Trash2 size={20}/>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm">
              <span className="block text-[11px] text-slate-400 uppercase font-black mb-3">Master production notes</span>
              {isEditing ? (
                <textarea className="w-full border border-slate-200 rounded-2xl p-4 h-48 font-medium text-sm" value={editFormData.description} onChange={e => setEditFormData({...editFormData, description: e.target.value})}/>
              ) : (
                <p className="text-xl text-slate-800 font-black whitespace-pre-wrap leading-relaxed">{order.description || 'N/A'}</p>
              )}
            </div>
            <div className="p-6 bg-indigo-50/30 rounded-3xl border border-indigo-100 shadow-inner">
              <h4 className="font-black text-indigo-400 uppercase text-[10px] flex items-center gap-2 mb-4">
                <Paperclip size={14}/> Technical documents
              </h4>
              <div className="space-y-3">
                {(isEditing ? editFormData.attachments : order.attachments)?.map((att, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-white rounded-xl border border-indigo-50 group hover:shadow-md transition-all">
                    <a href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-4 flex-1">
                      {att.type === 'image' ? <ImageIcon size={20} className="text-indigo-400" /> : <FileText size={20} className="text-indigo-400" />}
                      <span className="text-sm font-black text-slate-700 truncate">{att.name}</span>
                    </a>
                    {isEditing && (
                      <button onClick={() => setEditFormData({...editFormData, attachments: (editFormData.attachments || []).filter((_, idx) => idx !== i)})} className="text-slate-300 hover:text-red-500 transition-colors">
                        <Trash2 size={20}/>
                      </button>
                    )}
                  </div>
                ))}
                {isEditing && (
                  <div className="mt-4 border-2 border-dashed border-indigo-100 rounded-2xl p-6 text-center relative hover:bg-white transition-all cursor-pointer">
                    <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => e.target.files && setSelectedFiles(prev => [...prev, ...Array.from(e.target.files!)])}/>
                    <Upload size={32} className="mx-auto text-indigo-400"/>
                    <p className="text-[10px] font-black text-indigo-600 uppercase mt-2 tracking-widest">Add technical files</p>
                  </div>
                )}
                {selectedFiles.length > 0 && isEditing && (
                  <div className="mt-2 space-y-1">
                    {selectedFiles.map((f, idx) => (
                      <div key={idx} className="text-[10px] font-bold text-indigo-500 bg-white px-2 py-1 rounded border border-indigo-100 flex justify-between items-center">
                        {f.name}
                        <button type="button" onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))}><X size={10}/></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm flex flex-col">
            <h4 className="font-black text-indigo-900 uppercase text-[10px] flex items-center gap-2 mb-6">
              <Clock size={16}/> Lifecycle status log
            </h4>
            <div className="space-y-6 max-h-[400px] overflow-y-auto pr-4">
              {modalLogs.map(log => (
                <div key={log.id} className="flex gap-4 border-l-4 border-indigo-100 pl-6 pb-2 transition-all hover:border-indigo-400">
                  <div className="font-black text-[10px] text-slate-400 uppercase leading-none pt-1">
                    {new Date(log.created_at).toLocaleDateString()}<br/>
                    <span className="text-indigo-400 opacity-60 font-bold">{new Date(log.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                  </div>
                  <div className="flex-1 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                    <p className="text-slate-700 font-bold leading-snug">{log.message}</p>
                    {(log.attachments || []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(log.attachments || []).map((a, i) => (
                          <a key={i} href={a.url} target="_blank" rel="noreferrer" className="block">
                            <img src={a.url} alt={a.name || 'attachment'} className="w-16 h-16 object-cover rounded-lg border" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {detailedReqs.length > 0 && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center gap-3">
                <Calculator size={20} className="text-indigo-600"/>
                <h4 className="font-black text-slate-700 uppercase tracking-tight text-lg">Granular Material Forecast</h4>
              </div>
              <div className="grid grid-cols-1 gap-6">
                {detailedReqs.map((req, i) => (
                  <div key={i} className="bg-white rounded-3xl border border-indigo-100 shadow-sm overflow-hidden group">
                    <div className="p-5 bg-indigo-600 text-white flex items-center justify-between">
                      <span className="font-black uppercase tracking-widest text-sm">{req.name}</span>
                      <div className="flex items-center gap-4">
                         <span className="text-[10px] font-bold opacity-60 uppercase">Calculated Job Total</span>
                         <span className="text-xl font-black">{req.total}</span>
                      </div>
                    </div>
                    <div className="p-6">
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {req.breakdown.map((b, idx) => (
                          <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 hover:border-indigo-300 transition-colors">
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-[9px] font-black text-indigo-500 uppercase tracking-widest block mb-1">{b.label}</span>
                                <span className="text-xs font-bold text-slate-500">Volume: {b.count} Pcs</span>
                              </div>
                              <div className="text-right">
                                <span className="text-xl font-black text-indigo-700">{b.calc}</span>
                                <span className="text-[8px] block font-black text-slate-400 uppercase">Estimated</span>
                              </div>
                            </div>
                            
                            <div className="p-3 bg-white rounded-xl border border-slate-100">
                               <p className="text-xs font-bold text-slate-700 leading-relaxed italic">"{b.text || 'No specific notes.'}"</p>
                               {b.attachments.length > 0 && (
                                 <div className="mt-3 flex flex-wrap gap-2">
                                    {b.attachments.map((att, attIdx) => (
                                      <a key={attIdx} href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[9px] font-black border border-indigo-100 hover:bg-indigo-100 transition-all">
                                        {att.type === 'image' ? <ImageIcon size={10}/> : <FileText size={10}/>} {att.name}
                                      </a>
                                    ))}
                                 </div>
                               )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="p-6 border-t bg-slate-50 flex justify-between items-center">
          <div className="flex gap-2">
            {!isEditing && (
              <button onClick={() => { if(confirm("Permanently delete this order?")) deleteOrder(order.id).then(() => {onRefresh(); onClose();}); }} className="p-3 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-all">
                <Trash2 size={24}/>
              </button>
            )}
            {isEditing && (
              <button onClick={() => { setIsEditing(false); setEditFormData({...order}); setLinkedStyle(null); setSelectedFiles([]); }} className="px-6 py-3 bg-white text-slate-400 border border-slate-200 rounded-xl font-black uppercase text-xs hover:bg-slate-100 transition-all">
                Cancel
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handlePrintMaterialForecast} className="px-6 py-3 bg-white text-indigo-600 border border-indigo-600 rounded-xl font-black uppercase text-[10px] flex items-center gap-2 shadow-sm hover:bg-indigo-50 transition-all">
              <Calculator size={16}/> Print Material Forecast
            </button>
            <button onClick={handlePrint} className="px-8 py-3 bg-white text-indigo-600 border-2 border-indigo-600 rounded-xl font-black uppercase text-xs flex items-center gap-2 shadow-sm hover:bg-indigo-50 transition-all"><Printer size={16}/> Print Job Sheet</button>
            {!isEditing && <button onClick={onClose} className="px-10 py-3 bg-slate-800 text-white rounded-xl font-black uppercase text-xs hover:bg-slate-700 transition-all">Close</button>}
            {isEditing && (
              <button 
                onClick={handleSave} 
                disabled={isUploading} 
                className="bg-indigo-600 text-white px-10 py-3 rounded-xl font-black uppercase text-xs shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2"
              >
                {isUploading ? <Loader2 className="animate-spin" size={16}/> : <Save size={18}/>}
                {isUploading ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
