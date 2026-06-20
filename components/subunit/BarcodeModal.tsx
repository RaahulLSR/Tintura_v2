
import React, { useState } from 'react';
import { Printer, X } from 'lucide-react';

interface BarcodeModalProps {
  orderId: string;
  style: string;
  onGenerate: (qty: number, size: string) => void;
  onClose: () => void;
  sizeOptions: string[];
}

export const BarcodeModal: React.FC<BarcodeModalProps> = ({
  orderId,
  style,
  onGenerate,
  onClose,
  sizeOptions
}) => {
  const [form, setForm] = useState({ qty: 10, size: sizeOptions[1] || 'M' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerate(form.qty, form.size);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white p-8 rounded-xl shadow-2xl w-96 animate-scale-up">
        <h3 className="text-xl font-bold mb-4 text-slate-800 flex items-center gap-2">
          <Printer size={20} /> Print Production Labels
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-tighter">Size</label>
            <select 
              className="w-full border rounded-lg p-2.5 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500"
              value={form.size}
              onChange={e => setForm({ ...form, size: e.target.value })}
            >
              {sizeOptions.map(sz => <option key={sz} value={sz}>{sz}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-tighter">Labels to Print</label>
            <input 
              type="number" min="1" max="1000"
              className="w-full border rounded-lg p-2.5 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500"
              value={form.qty}
              onChange={e => setForm({ ...form, qty: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500">Cancel</button>
            <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-bold shadow-lg hover:bg-indigo-700">
              Generate & Print
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
