
import React, { useState, useEffect } from 'react';
import { X, Plus, PlusCircle, ArrowLeftRight, Trash2, Upload, ImageIcon, Send, Loader2, BookOpen, ChevronUp, ChevronDown, Ruler } from 'lucide-react';
import { Unit, SizeBreakdown, Attachment, Style, normalizeSize, getSizeKeyFromLabel } from '../../types';
import { createOrder, uploadOrderAttachment, triggerOrderEmail, fetchStyles, upsertStyle, postOrderToChat } from '../../services/db';

interface LaunchOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  units: Unit[];
  onSuccess: () => void;
}

export const LaunchOrderModal: React.FC<LaunchOrderModalProps> = ({ isOpen, onClose, units, onSuccess }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [useNumericSizes, setUseNumericSizes] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [availableStyles, setAvailableStyles] = useState<Style[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string>('');
  const [newOrder, setNewOrder] = useState({ style_number: '', unit_id: 1, target_delivery_date: '', description: '', box_count: 0 });
  
  // Size Management
  const [sizeSequence, setSizeSequence] = useState<string[]>(['S', 'M', 'L', 'XL', 'XXL', '3XL']);
  const [newSizeName, setNewSizeName] = useState('');
  
  const [breakdown, setBreakdown] = useState<SizeBreakdown[]>([{ color: '', s: 0, m: 0, l: 0, xl: 0, xxl: 0, xxxl: 0 }]);

  useEffect(() => {
    if (isOpen) {
      fetchStyles().then(setAvailableStyles);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Flip lettered <-> numeric and reset the sequence to that format's defaults.
  const toggleSizeFormat = () => {
    const next = !useNumericSizes;
    setUseNumericSizes(next);
    setSizeSequence(next ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL']);
  };

  const handleStyleSelect = (styleId: string) => {
    setSelectedStyleId(styleId);
    const style = availableStyles.find(s => s.id === styleId);
    if (!style) {
      setNewOrder({ ...newOrder, style_number: '' });
      return;
    }
    
    setNewOrder({
      ...newOrder,
      style_number: `${style.style_number} - ${style.style_text}`
    });
    
    const isNum = style.size_type === 'number';
    setUseNumericSizes(isNum);
    
    // Prefetch the size sequence from the Style DB. Compute it locally so the
    // colour breakdown below can use it immediately (state updates are async).
    const nextSizes = (style.available_sizes && style.available_sizes.length > 0)
      ? style.available_sizes.map(s => normalizeSize(s))
      : (isNum ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL']);
    setSizeSequence(nextSizes);
    
    // Build a colour row per available colour, with every prefetched size slot
    // initialised to 0 so the matrix is ready to fill.
    const colors = (style.available_colors || []).filter(c => c.trim() !== '');
    if (colors.length > 0) {
      const newBreakdown = colors.map(color => {
        const row: SizeBreakdown = { color };
        nextSizes.forEach(label => {
          const key = getSizeKeyFromLabel(label, isNum ? 'numeric' : 'standard');
          row[key] = 0;
        });
        return row;
      });
      setBreakdown(newBreakdown);
    }
  };

  const addCustomSize = () => {
    const normalized = normalizeSize(newSizeName);
    if (!normalized) return;
    if (sizeSequence.map(s => normalizeSize(s)).includes(normalized)) {
      alert("Size already exists in matrix.");
      return;
    }

    setSizeSequence(prev => [...prev, normalized]);
    
    // Update breakdown to include new key if needed
    setBreakdown(prev => prev.map(row => {
       const key = getSizeKeyFromLabel(normalized, useNumericSizes ? 'numeric' : 'standard');
       if (row[key] === undefined) return { ...row, [key]: 0 };
       return row;
    }));

    setNewSizeName('');
  };

  const removeSize = (label: string) => {
    if (sizeSequence.length <= 1) return;
    if (!confirm(`Remove size ${label} from this order matrix?`)) return;
    setSizeSequence(prev => prev.filter(s => s !== label));
  };

  const moveSize = (index: number, direction: 'up' | 'down') => {
    const newSeq = [...sizeSequence];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= newSeq.length) return;
    [newSeq[index], newSeq[target]] = [newSeq[target], newSeq[index]];
    setSizeSequence(newSeq);
  };

  const getRowTotal = (row: SizeBreakdown) => {
    let total = 0;
    sizeSequence.forEach(label => {
      const key = getSizeKeyFromLabel(label, useNumericSizes ? 'numeric' : 'standard');
      total += (row[key] || 0);
    });
    return total;
  };

  const getTotalQuantity = (bd: SizeBreakdown[]) => bd.reduce((acc, row) => acc + getRowTotal(row), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const quantity = getTotalQuantity(breakdown);
    if (quantity === 0) return alert("Total quantity cannot be zero");

    setIsUploading(true);
    try {
      const attachments: Attachment[] = [];
      for (const file of selectedFiles) {
        const url = await uploadOrderAttachment(file);
        if (url) attachments.push({ name: file.name, url, type: file.type.startsWith('image/') ? 'image' : 'document' });
      }

      // If we added new sizes, check if we should update the linked style
      if (selectedStyleId) {
        const style = availableStyles.find(s => s.id === selectedStyleId);
        if (style) {
          const currentStyleSizes = (style.available_sizes || []).map(s => normalizeSize(s));
          const hasNewSizes = sizeSequence.some(s => !currentStyleSizes.includes(s));
          if (hasNewSizes) {
            const updatedStyle = { ...style, available_sizes: Array.from(new Set([...currentStyleSizes, ...sizeSequence])) };
            await upsertStyle(updatedStyle);
          }
        }
      }

      const { data, error } = await createOrder({ 
        ...newOrder, 
        quantity, 
        size_breakdown: breakdown, 
        attachments, 
        size_format: useNumericSizes ? 'numeric' : 'standard',
        size_sequence: sizeSequence
      });

      if (data) {
        await triggerOrderEmail(data.id, false);
        await postOrderToChat(data);
        onSuccess();
        onClose();
      } else {
        alert(`Error: ${error}`);
      }
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[95vh] animate-scale-up border border-slate-200">
        <div className="p-6 border-b flex justify-between items-center bg-slate-50">
          <h3 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-indigo-600 text-white rounded-lg shadow-lg"><Plus size={24}/></div>
            Launch Production Order
          </h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={32}/></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 space-y-8">
          
          <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 flex flex-col md:flex-row items-center gap-6">
            <div className="flex items-center gap-3 shrink-0">
               <div className="p-3 bg-white rounded-xl text-indigo-600 shadow-sm border border-indigo-50">
                 <BookOpen size={24}/>
               </div>
               <div>
                 <h4 className="font-black text-indigo-900 text-sm uppercase tracking-tight leading-none">Auto-Fill from Database</h4>
                 <p className="text-indigo-400 text-[10px] font-bold uppercase tracking-widest mt-1">Link this order to a technical style</p>
               </div>
            </div>
            <div className="flex-1 w-full">
              <select 
                className="w-full bg-white border-2 border-indigo-200 rounded-xl px-5 py-4 text-sm font-black text-indigo-700 outline-none focus:ring-4 focus:ring-indigo-100 cursor-pointer shadow-sm"
                value={selectedStyleId}
                onChange={e => handleStyleSelect(e.target.value)}
              >
                <option value="">-- [OPTIONAL] Select Style from Technical DB --</option>
                {availableStyles.map(s => (
                  <option key={s.id} value={s.id}>{s.style_number} - {s.style_text}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Style Reference</label><input required className="w-full border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={newOrder.style_number} onChange={e => setNewOrder({...newOrder, style_number: e.target.value})}/></div>
            <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Assign Facility</label><select className="w-full border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={newOrder.unit_id} onChange={e => setNewOrder({...newOrder, unit_id: parseInt(e.target.value)})}>{units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Planned Box Count</label><input required type="number" min="1" className="w-full border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-black focus:ring-2 focus:ring-indigo-500 outline-none" value={newOrder.box_count} onChange={e => setNewOrder({...newOrder, box_count: parseInt(e.target.value) || 0})}/></div>
            <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Delivery Due</label><input required type="date" className="w-full border-2 border-slate-100 rounded-xl p-4 bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={newOrder.target_delivery_date} onChange={e => setNewOrder({...newOrder, target_delivery_date: e.target.value})}/></div>
          </div>

          {/* ADVANCED SIZE MANAGEMENT */}
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
             <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                   <Ruler size={18} className="text-indigo-600"/>
                   <h4 className="font-black text-slate-700 text-xs uppercase tracking-widest">Active Size Matrix Configuration</h4>
                </div>
                <button type="button" onClick={toggleSizeFormat} className="text-[10px] font-black bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm uppercase tracking-widest transition-all hover:bg-slate-50">
                  <ArrowLeftRight size={14} className="inline mr-2"/> Switch to {useNumericSizes ? 'Lettered' : 'Numeric'}
                </button>
             </div>
             
             <div className="flex flex-wrap gap-3 items-end">
                {sizeSequence.map((label, idx) => (
                  <div key={idx} className="group relative bg-white border border-slate-200 p-2 rounded-xl shadow-sm flex flex-col items-center min-w-[70px]">
                    <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10">
                       <button type="button" onClick={() => moveSize(idx, 'up')} className="bg-white border p-1 rounded hover:bg-indigo-50 text-indigo-600"><ChevronUp size={10}/></button>
                       <button type="button" onClick={() => moveSize(idx, 'down')} className="bg-white border p-1 rounded hover:bg-indigo-50 text-indigo-600"><ChevronDown size={10}/></button>
                       <button type="button" onClick={() => removeSize(label)} className="bg-white border p-1 rounded hover:bg-red-50 text-red-600"><X size={10}/></button>
                    </div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1">POS {idx+1}</span>
                    <span className="text-sm font-black text-indigo-700 uppercase">{label}</span>
                  </div>
                ))}
                
                <div className="flex gap-2 bg-white p-2 rounded-xl border border-indigo-200 shadow-sm">
                   <input 
                      type="text" 
                      placeholder="Add Size (e.g. XXL)" 
                      className="w-32 border-none bg-transparent text-sm font-bold focus:ring-0 outline-none uppercase"
                      value={newSizeName}
                      onChange={e => setNewSizeName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCustomSize())}
                   />
                   <button type="button" onClick={addCustomSize} className="bg-indigo-600 text-white p-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
                      <Plus size={16}/>
                   </button>
                </div>
             </div>
             <p className="text-[9px] font-bold text-slate-400 italic">Normalization rules: 2XL auto-mapped to XXL, 3XL to XXXL. Case-insensitive inputs.</p>
          </div>

          <div>
            <div className="flex justify-between items-center mb-4"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Order Volume Matrix</label></div>
            <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-lg overflow-x-auto">
              <table className="w-full text-center text-sm border-collapse min-w-max">
                <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[10px] tracking-widest border-b">
                  <tr>
                    <th className="p-4 text-left border-r">Color Variant</th>
                    {sizeSequence.map(label => <th key={label} className="p-4 border-r">{label}</th>)}
                    <th className="p-4 bg-slate-100">Row Sum</th>
                    <th className="p-4 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {breakdown.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3 border-r min-w-[150px]"><input placeholder="e.g. Navy" className="w-full border-2 border-slate-50 rounded-xl px-4 py-3 bg-white focus:ring-2 focus:ring-indigo-500 font-bold outline-none" value={row.color} onChange={e => { const nb = [...breakdown]; nb[idx].color = e.target.value; setBreakdown(nb); }}/></td>
                    {sizeSequence.map(label => {
                      const key = getSizeKeyFromLabel(label, useNumericSizes ? 'numeric' : 'standard');
                      return (
                        <td key={label} className="p-3 border-r w-20">
                          <input type="number" className="w-full border-2 border-slate-50 rounded-xl px-2 py-3 text-center bg-white focus:ring-2 focus:ring-indigo-500 font-black outline-none" value={row[key] || ''} onChange={e => { const nb = [...breakdown]; nb[idx][key] = parseInt(e.target.value) || 0; setBreakdown(nb); }}/>
                        </td>
                      );
                    })}
                    <td className="p-3 font-black text-indigo-700 bg-slate-50/50 tabular-nums text-lg">{getRowTotal(row)}</td>
                    <td className="p-3">{breakdown.length > 1 && <button type="button" onClick={() => setBreakdown(breakdown.filter((_, i) => i !== idx))} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={20}/></button>}</td>
                  </tr>))}
                </tbody></table>
              <button type="button" onClick={() => {
                const newRow: SizeBreakdown = { color: '' };
                sizeSequence.forEach(l => { newRow[getSizeKeyFromLabel(l, useNumericSizes ? 'numeric' : 'standard')] = 0; });
                setBreakdown([...breakdown, newRow]);
              }} className="w-full py-5 text-[10px] font-black text-indigo-600 hover:bg-indigo-50 border-t border-slate-100 transition-colors bg-slate-50/20 uppercase tracking-widest flex items-center justify-center gap-2"><PlusCircle size={16}/> Add New Color Variant</button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Production Notes</label><textarea className="w-full border-2 border-slate-100 rounded-3xl p-6 h-48 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" value={newOrder.description} onChange={e => setNewOrder({...newOrder, description: e.target.value})}></textarea></div>
            <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Technical Attachments</label>
              <div className="border-4 border-dashed border-slate-100 rounded-3xl p-8 bg-slate-50 hover:bg-indigo-50/30 hover:border-indigo-200 relative h-48 flex flex-col items-center justify-center cursor-pointer transition-all">
                <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => e.target.files && setSelectedFiles(prev => [...prev, ...Array.from(e.target.files!)])}/>
                <Upload size={48} className="text-slate-300 mb-3" /><p className="text-base font-black text-slate-700 uppercase">Drop Techpacks</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">{selectedFiles.map((f, i) => (<div key={i} className="flex items-center gap-2 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-black shadow-md"><ImageIcon size={14}/> {f.name} <button type="button" onClick={() => setSelectedFiles(prev => prev.filter((_, idx) => idx !== i))}><X size={14}/></button></div>))}</div>
            </div>
          </div>
          <div className="flex justify-end gap-4 pt-8 border-t">
            <button type="button" onClick={onClose} className="px-10 py-4 font-black text-slate-400 hover:bg-slate-100 rounded-2xl uppercase tracking-widest text-xs">Discard</button>
            <button type="submit" disabled={isUploading} className="px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-2xl shadow-indigo-200 flex items-center gap-3 transition-all active:scale-95 disabled:opacity-50 uppercase tracking-widest text-xs">
              {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Send size={18}/>} Launch Order
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
