
import React, { useState, useRef } from 'react';
import { X, FileUp, CheckCircle2, AlertCircle, Loader2, Save, ChevronDown, Check } from 'lucide-react';
import { Style, StyleTemplate, TechPackItem } from '../../types';
import { upsertStyle, recordBulkEditHistory } from '../../services/db';

interface BulkAttributeUpdateModalProps {
  styles: Style[];
  template: StyleTemplate | null;
  onClose: () => void;
  onRefresh: () => void;
}

interface UpdateSummary {
  updated: number;
  notFound: string[];
  total: number;
}

export const BulkAttributeUpdateModal: React.FC<BulkAttributeUpdateModalProps> = ({ styles, template, onClose, onRefresh }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedField, setSelectedField] = useState<string>('style_text');
  const [summary, setSummary] = useState<UpdateSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Define available fields for the dropdown
  const fieldOptions = [
    { id: 'style_text', label: 'Short Description', type: 'basic' },
    { id: 'garment_type', label: 'Garment Type', type: 'basic' },
    { id: 'demographic', label: 'Demographic', type: 'basic' },
    { id: 'category', label: 'Category', type: 'basic' },
    { id: 'packing_type', label: 'Packing Type', type: 'basic' },
    { id: 'pcs_per_box', label: 'Pcs Per Box', type: 'basic' },
  ];

  // Add template-based technical fields
  if (template) {
    template.config.forEach(cat => {
      cat.fields.forEach(f => {
        fieldOptions.push({ id: `tech|${cat.name}|${f}`, label: `${cat.name} → ${f}`, type: 'tech' });
      });
    });
  }

  const processCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setSummary(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
      
      const splitCSV = (row: string) => {
        const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
        return row.split(regex).map(val => {
          let cleaned = val.trim();
          if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            cleaned = cleaned.substring(1, cleaned.length - 1);
          }
          return cleaned;
        });
      };

      const rows = lines.map(splitCSV);
      const firstRowLabel = rows[0][0].toLowerCase();
      const startIndex = (firstRowLabel.includes('style') || firstRowLabel.includes('number')) ? 1 : 0;

      // IDENTIFY ALL TARGET STYLES FOR SNAPSHOT
      const stylesToSnapshot: Style[] = [];
      for (let i = startIndex; i < rows.length; i++) {
        const [styleNum] = rows[i];
        if (!styleNum) continue;
        const match = styles.find(s => s.style_number.trim().toLowerCase() === styleNum.trim().toLowerCase());
        if (match) stylesToSnapshot.push(match);
      }

      // RECORD HISTORY BEFORE MODIFICATION
      const fieldName = fieldOptions.find(o => o.id === selectedField)?.label || selectedField;
      await recordBulkEditHistory(`CSV Attribute Sync: ${fieldName}`, stylesToSnapshot);

      let updatedCount = 0;
      const notFoundStyles: string[] = [];

      for (let i = startIndex; i < rows.length; i++) {
        const [styleNum, value] = rows[i];
        if (!styleNum) continue;

        const targetStyle = styles.find(s => s.style_number.trim().toLowerCase() === styleNum.trim().toLowerCase());

        if (targetStyle) {
          const updated = JSON.parse(JSON.stringify(targetStyle));

          if (selectedField.startsWith('tech|')) {
            const [, catName, fieldName] = selectedField.split('|');
            if (!updated.tech_pack[catName]) updated.tech_pack[catName] = {};
            if (!updated.tech_pack[catName][fieldName]) {
              updated.tech_pack[catName][fieldName] = { text: value, attachments: [] };
            } else {
              updated.tech_pack[catName][fieldName].text = value;
            }
          } else {
            // Basic field update
            if (selectedField === 'pcs_per_box') {
              updated[selectedField] = parseInt(value) || 0;
            } else {
              (updated as any)[selectedField] = value;
            }
          }

          const { error } = await upsertStyle(updated);
          if (!error) updatedCount++;
        } else {
          notFoundStyles.push(styleNum);
        }
      }

      setSummary({
        updated: updatedCount,
        notFound: notFoundStyles,
        total: rows.length - startIndex
      });
      setIsProcessing(false);
      onRefresh();
    };
    reader.readAsText(file);
    e.target.value = ''; 
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[110] flex items-center justify-center p-4 backdrop-blur-md">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden animate-scale-up border border-slate-200 flex flex-col">
        <div className="p-6 border-b bg-green-50 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-xl font-black text-green-900 uppercase tracking-tight flex items-center gap-2">
              <FileUp size={24}/> Attribute Value Synchronizer
            </h3>
            <p className="text-green-700 text-[10px] font-bold uppercase tracking-widest mt-1">Update specific fields across multiple styles using CSV</p>
          </div>
          <button onClick={onClose} className="text-green-400 hover:text-green-600 p-2"><X size={28}/></button>
        </div>

        <div className="p-8 flex-1 space-y-8 bg-white">
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-black text-xs">1</div>
              <label className="block text-xs font-black text-slate-500 uppercase tracking-widest">Select Target Field</label>
            </div>
            <div className="relative group">
              <select 
                className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-sm font-black text-slate-700 outline-none focus:ring-4 focus:ring-indigo-100 cursor-pointer shadow-sm transition-all appearance-none"
                value={selectedField}
                onChange={e => setSelectedField(e.target.value)}
              >
                <optgroup label="Basic Style Fields">
                  {fieldOptions.filter(o => o.type === 'basic').map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Technical Blueprint Fields">
                  {fieldOptions.filter(o => o.type === 'tech').map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </optgroup>
              </select>
              <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none group-hover:text-indigo-500 transition-colors" size={20}/>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-black text-xs">2</div>
              <label className="block text-xs font-black text-slate-500 uppercase tracking-widest">Upload 2-Column CSV</label>
            </div>
            
            <div 
              onClick={() => !isProcessing && fileInputRef.current?.click()}
              className={`border-4 border-dashed rounded-3xl p-10 text-center transition-all cursor-pointer group ${isProcessing ? 'border-slate-100 bg-slate-50' : 'border-indigo-100 bg-indigo-50/20 hover:border-indigo-400 hover:bg-white'}`}
            >
              <input type="file" accept=".csv" ref={fileInputRef} className="hidden" onChange={processCSV} />
              {isProcessing ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="text-indigo-600 animate-spin mb-3" size={40}/>
                  <p className="font-black text-slate-600 uppercase tracking-widest text-sm">Processing Style Mapping...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <FileUp className="text-indigo-300 group-hover:text-indigo-600 mb-3 transition-colors" size={48}/>
                  <p className="font-black text-slate-700 uppercase tracking-widest text-sm">Drop .CSV File Here</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mt-2">Col A: Style Number &nbsp;|&nbsp; Col B: New Value</p>
                </div>
              )}
            </div>
          </div>

          {summary && (
            <div className="animate-fade-in p-6 bg-slate-50 rounded-3xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                 <h4 className="font-black text-slate-800 uppercase text-xs tracking-widest">Sync Complete</h4>
                 <div className="flex items-center gap-2 px-3 py-1 bg-green-100 text-green-700 rounded-full text-[10px] font-black uppercase">
                   <CheckCircle2 size={12}/> {summary.updated} / {summary.total} Styles Updated
                 </div>
              </div>

              {summary.notFound.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-red-600 text-[10px] font-black uppercase tracking-widest">
                    <AlertCircle size={14}/> Not Found in DB ({summary.notFound.length})
                  </div>
                  <div className="max-h-32 overflow-y-auto bg-white border border-red-100 rounded-xl p-3 font-mono text-[10px] text-slate-400 flex flex-wrap gap-2">
                    {summary.notFound.map((sn, idx) => (
                      <span key={idx} className="bg-red-50 px-2 py-1 rounded border border-red-100">{sn}</span>
                    ))}
                  </div>
                </div>
              )}
              
              <button 
                onClick={onClose}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-xs hover:bg-black transition-all shadow-xl shadow-slate-200"
              >
                Close Summary
              </button>
            </div>
          )}
        </div>

        {!summary && (
          <div className="p-6 bg-slate-50 border-t flex justify-between items-center">
            <button onClick={onClose} className="px-8 py-3 font-black text-slate-400 hover:text-slate-600 uppercase text-xs">Cancel</button>
            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 italic">
               * Updates are permanent in the style database.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
