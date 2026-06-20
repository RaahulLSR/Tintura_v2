
import React from 'react';
import { Table, X, Check } from 'lucide-react';
import { Style, StyleTemplate } from '../../types';

interface AuditMatrixModalProps {
  styles: Style[];
  template: StyleTemplate | null;
  onClose: () => void;
  onCellClick: (style: Style, catName: string, fieldName?: string) => void;
  checkCompleteness: (style: Style, cat: string, field: string) => boolean;
}

export const AuditMatrixModal: React.FC<AuditMatrixModalProps> = ({ 
  styles, 
  template, 
  onClose, 
  onCellClick, 
  checkCompleteness 
}) => {
  if (!template) return null;

  // Helper to determine column structure
  const getCategoryColumns = (cat: any) => {
    const isPreProd = cat.name.toLowerCase().includes('pre production');
    const isPacking = cat.name.toLowerCase().includes('packing');
    
    let extraCols = 0;
    if (isPreProd) extraCols = 3; // Colours, Sizes, Size Type
    if (isPacking) extraCols = 2; // Type, Pcs/Box
    
    return cat.fields.length + extraCols;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[98vw] h-[95vh] overflow-hidden flex flex-col animate-scale-up border border-slate-200">
         <div className="p-6 border-b flex justify-between items-center bg-slate-50 shrink-0">
            <div>
               <h3 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3"><Table className="text-indigo-600"/> Master Completeness Matrix</h3>
               <p className="text-slate-500 text-xs font-bold uppercase mt-1">Audit every input field across all manufacturing blueprints</p>
            </div>
            <button onClick={onClose} className="text-slate-300 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-all"><X size={32}/></button>
         </div>
         
         <div className="flex-1 overflow-auto p-4 bg-slate-100/50">
            <div className="bg-white rounded-2xl border shadow-xl overflow-hidden min-w-max">
               <table className="w-full border-collapse">
                  <thead>
                     {/* Group Header Row */}
                     <tr className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">
                        <th className="p-4 border-r border-slate-800 sticky left-0 z-20 bg-slate-900" rowSpan={2}>Style Info</th>
                        <th className="p-2 border-r border-slate-800 bg-slate-800" colSpan={4}>Basic Parameters</th>
                        {template.config.map(cat => (
                          <th 
                            key={cat.name} 
                            className={`p-2 border-r border-slate-800 ${cat.name.toLowerCase().includes('measurement chart') ? 'bg-indigo-900' : 'bg-slate-700'}`} 
                            colSpan={getCategoryColumns(cat)}
                          >
                            {cat.name}
                          </th>
                        ))}
                     </tr>
                     {/* Field Header Row */}
                     <tr className="bg-slate-800 text-slate-400 text-[9px] font-black uppercase tracking-tighter border-b border-slate-700">
                        {/* Basic Parameters */}
                        <th className="p-3 border-r border-slate-700">Garment</th>
                        <th className="p-3 border-r border-slate-700">Demo</th>
                        <th className="p-3 border-r border-slate-700">Category</th>
                        <th className="p-3 border-r border-slate-700">Short Desc</th>

                        {/* Dynamic Categories */}
                        {template.config.map(cat => {
                          const isPreProd = cat.name.toLowerCase().includes('pre production');
                          const isPacking = cat.name.toLowerCase().includes('packing');
                          
                          return (
                            <React.Fragment key={`head-${cat.name}`}>
                              {isPreProd && (
                                <>
                                  <th className="p-3 border-r border-slate-700 bg-slate-900 text-indigo-300">Colours</th>
                                  <th className="p-3 border-r border-slate-700 bg-slate-900 text-indigo-300">Sizes</th>
                                  <th className="p-3 border-r border-slate-700 bg-slate-900 text-indigo-300">Size Type</th>
                                </>
                              )}
                              {isPacking && (
                                <>
                                  <th className="p-3 border-r border-slate-700 bg-slate-900 text-indigo-300">Pack Type</th>
                                  <th className="p-3 border-r border-slate-700 bg-slate-900 text-indigo-300">Pcs/Box</th>
                                </>
                              )}
                              {cat.fields.map(f => (
                                <th key={`head-${cat.name}-${f}`} className="p-3 border-r border-slate-700 min-w-[110px]">{f}</th>
                              ))}
                            </React.Fragment>
                          );
                        })}
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {styles.map(style => (
                      <tr key={style.id} className="hover:bg-slate-50 transition-colors group">
                         {/* Row ID / Frozen Column */}
                         <td className="p-4 border-r font-black text-slate-800 sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)]">
                           <button onClick={() => onCellClick(style, 'General Info')} className="hover:text-indigo-600 transition-colors uppercase tracking-tight">{style.style_number}</button>
                         </td>
                         
                         {/* Basic Info Cells */}
                         <td className="p-2 border-r text-center">{style.garment_type ? <Check size={14} className="mx-auto text-green-500"/> : <X size={14} className="mx-auto text-slate-200"/>}</td>
                         <td className="p-2 border-r text-center">{style.demographic ? <Check size={14} className="mx-auto text-green-500"/> : <X size={14} className="mx-auto text-slate-200"/>}</td>
                         <td className="p-2 border-r text-center">{style.category ? <Check size={14} className="mx-auto text-green-500"/> : <X size={14} className="mx-auto text-slate-200"/>}</td>
                         <td className="p-2 border-r text-center cursor-pointer" onClick={() => onCellClick(style, 'General Info')}>{style.style_text ? <Check size={14} className="mx-auto text-green-500"/> : <X size={14} className="mx-auto text-slate-200"/>}</td>

                         {/* Dynamic Category Data Cells */}
                         {template.config.map(cat => {
                            const isPreProd = cat.name.toLowerCase().includes('pre production');
                            const isPacking = cat.name.toLowerCase().includes('packing');
                            
                            return (
                              <React.Fragment key={`body-${style.id}-${cat.name}`}>
                                {isPreProd && (
                                  <>
                                    <td className="p-2 border-r text-center cursor-pointer bg-indigo-50/20" onClick={() => onCellClick(style, cat.name, 'preprod')}>
                                      {(style.available_colors || []).filter(c => c && c.trim() !== '').length > 0 ? <Check size={14} className="mx-auto text-green-600"/> : <X size={14} className="mx-auto text-slate-300"/>}
                                    </td>
                                    <td className="p-2 border-r text-center cursor-pointer bg-indigo-50/20" onClick={() => onCellClick(style, cat.name, 'preprod')}>
                                      {(style.available_sizes || []).filter(s => s && s.trim() !== '').length > 0 ? <Check size={14} className="mx-auto text-green-600"/> : <X size={14} className="mx-auto text-slate-300"/>}
                                    </td>
                                    <td className="p-2 border-r text-center cursor-pointer bg-indigo-50/20" onClick={() => onCellClick(style, cat.name, 'preprod')}>
                                      {style.size_type ? <Check size={14} className="mx-auto text-green-600"/> : <X size={14} className="mx-auto text-slate-300"/>}
                                    </td>
                                  </>
                                )}
                                {isPacking && (
                                  <>
                                    <td className="p-2 border-r text-center cursor-pointer bg-indigo-50/20" onClick={() => onCellClick(style, cat.name, 'packing_type')}>
                                      {style.packing_type ? <Check size={14} className="mx-auto text-green-600"/> : <X size={14} className="mx-auto text-slate-300"/>}
                                    </td>
                                    <td className="p-2 border-r text-center cursor-pointer bg-indigo-50/20" onClick={() => onCellClick(style, cat.name, 'pcs_per_box')}>
                                      {style.pcs_per_box > 0 ? <Check size={14} className="mx-auto text-green-600"/> : <X size={14} className="mx-auto text-slate-300"/>}
                                    </td>
                                  </>
                                )}
                                {cat.fields.map(f => {
                                  const isFilled = checkCompleteness(style, cat.name, f);
                                  const isMeas = cat.name.toLowerCase().includes('measurement chart');
                                  return (
                                    <td key={`cell-${style.id}-${cat.name}-${f}`} className={`p-2 border-r text-center cursor-pointer hover:bg-indigo-50 transition-colors ${isMeas ? 'bg-indigo-50/10' : ''}`} onClick={() => onCellClick(style, cat.name, f)}>
                                       {isFilled ? <Check size={14} className={`mx-auto ${isMeas ? 'text-indigo-700 font-black' : 'text-indigo-500'}`}/> : <div className="mx-auto w-1 h-1 bg-slate-200 rounded-full"></div>}
                                    </td>
                                  );
                                })}
                              </React.Fragment>
                            );
                         })}
                      </tr>
                    ))}
                  </tbody>
               </table>
            </div>
         </div>
         <div className="p-6 bg-slate-50 border-t flex flex-col md:flex-row justify-between items-center gap-4 shrink-0">
            <div className="flex flex-wrap gap-6">
               <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest"><Check size={16} className="text-green-500"/> Content Entered</div>
               <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest"><X size={16} className="text-slate-300"/> Field Empty</div>
               <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest"><div className="w-1.5 h-1.5 bg-slate-200 rounded-full"/> Technical field missing</div>
               <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest"><div className="w-4 h-4 bg-indigo-50 border border-indigo-100 rounded"/> Attribute Check (Hardcoded)</div>
            </div>
            <div className="flex items-center gap-3">
               <span className="text-xs font-bold text-slate-400">Styles Scanned: {styles.length}</span>
               <button onClick={onClose} className="px-10 py-3 bg-slate-900 text-white rounded-xl font-black shadow-lg hover:bg-slate-800 transition-all uppercase text-xs tracking-widest">Close Matrix Audit</button>
            </div>
         </div>
      </div>
    </div>
  );
};
