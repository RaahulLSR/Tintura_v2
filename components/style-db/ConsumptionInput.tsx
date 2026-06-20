
import React from 'react';
import { Calculator, X } from 'lucide-react';
import { ConsumptionType } from '../../types';

interface ConsumptionInputProps {
  type?: ConsumptionType;
  value?: number;
  onChange: (type: ConsumptionType, val: number) => void;
  onClear: () => void;
}

export const ConsumptionInput: React.FC<ConsumptionInputProps> = ({ type, value, onChange, onClear }) => {
  if (!type) {
    return (
      <button 
        type="button" 
        onClick={() => onChange('items_per_pc', 1)}
        className="text-[9px] font-black text-indigo-500 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-100 hover:bg-indigo-100 transition-all flex items-center gap-1.5"
      >
        <Calculator size={12}/> Set Ratio
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 animate-fade-in">
      <div className="flex bg-slate-200 p-0.5 rounded-lg border border-slate-300">
        <button 
          type="button" 
          onClick={() => onChange('items_per_pc', value || 0)}
          className={`px-2 py-1 rounded-md text-[8px] font-black uppercase transition-all ${type === 'items_per_pc' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
        >
          Items / PC
        </button>
        <button 
          type="button" 
          onClick={() => onChange('pcs_per_item', value || 0)}
          className={`px-2 py-1 rounded-md text-[8px] font-black uppercase transition-all ${type === 'pcs_per_item' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
        >
          PCS / Item
        </button>
      </div>
      <input 
        type="number" 
        step="any"
        className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs font-black text-indigo-700 bg-white focus:ring-1 focus:ring-indigo-500 outline-none"
        value={value || ''}
        onChange={e => onChange(type, parseFloat(e.target.value) || 0)}
        placeholder="Val"
      />
      <button type="button" onClick={onClear} className="text-slate-300 hover:text-red-500 transition-colors">
        <X size={14}/>
      </button>
    </div>
  );
};
