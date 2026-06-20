
import React from 'react';
import { X, Loader2, Plus } from 'lucide-react';

interface BulkImportModalProps {
  bulkImportData: any[];
  isUploading: boolean;
  onClose: () => void;
  onExecute: () => void;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ 
  bulkImportData, 
  isUploading, 
  onClose, 
  onExecute 
}) => {
  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl overflow-hidden animate-scale-up border border-slate-200 flex flex-col max-h-[90vh]">
        <div className="p-8 border-b bg-indigo-50 flex justify-between items-center">
          <div>
            <h3 className="text-2xl font-black text-indigo-900 uppercase tracking-tight">Bulk Import Preview</h3>
            <p className="text-indigo-700 text-xs font-bold uppercase tracking-widest mt-1">Found {bulkImportData.length} entries in CSV</p>
          </div>
          <button onClick={onClose} className="text-indigo-300 hover:text-indigo-600 transition-colors p-2"><X size={32}/></button>
        </div>
        
        <div className="p-8 flex-1 overflow-auto bg-slate-50/50">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[10px] border-b">
                <tr>
                  <th className="p-4">Style No.</th>
                  <th className="p-4">Garment</th>
                  <th className="p-4">Demographic</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Short description</th>
                  <th className="p-4">Colours</th>
                  <th className="p-4">Sizes</th>
                  <th className="p-4">Fabric</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bulkImportData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-black text-slate-800">{row['Style No.'] || row['Style No'] || row['StyleNo']}</td>
                    <td className="p-4">{row['GarmentType'] || row['Garment Type'] || row['Garment']}</td>
                    <td className="p-4">{row['Demographic'] || row['Demo']}</td>
                    <td className="p-4">{row['Category'] || row['Cat']}</td>
                    <td className="p-4 italic text-slate-500 line-clamp-1">{row['Short description'] || row['Description'] || row['Short Description']}</td>
                    <td className="p-4 max-w-[150px] truncate">{row['Available colours'] || row['Available colors'] || row['Colours'] || row['Colors']}</td>
                    <td className="p-4 max-w-[150px] truncate">{row['size variants'] || row['Size variants'] || row['Sizes']}</td>
                    <td className="p-4 font-bold text-indigo-600">{row['fabric'] || row['Fabric']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-8 border-t bg-white flex justify-between items-center shadow-2xl">
          <button type="button" onClick={onClose} className="px-10 py-4 font-black text-slate-400 hover:text-slate-600 uppercase text-xs">Cancel</button>
          <button 
            onClick={onExecute} 
            disabled={isUploading}
            className="px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-2xl shadow-indigo-200 flex items-center gap-3 active:scale-95 disabled:opacity-50 uppercase text-xs"
          >
            {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20}/>} Create All Technical Blueprints
          </button>
        </div>
      </div>
    </div>
  );
};
