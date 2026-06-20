
import React, { useRef, useState } from 'react';
import { OrderLog } from '../../types';
import { uploadOrderAttachment } from '../../services/db';
import { X, Clock, ListTodo, MessageSquare, Send, ImagePlus, Loader2 } from 'lucide-react';

interface TimelineModalProps {
  orderNo: string;
  logs: OrderLog[];
  statusUpdateText: string;
  setStatusUpdateText: (val: string) => void;
  onSubmitLog: (attachments: { url: string; name?: string }[]) => void | Promise<void>;
  onClose: () => void;
}

export const TimelineModal: React.FC<TimelineModalProps> = ({
  orderNo,
  logs,
  statusUpdateText,
  setStatusUpdateText,
  onSubmitLog,
  onClose
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => [...prev, ...imgs]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!statusUpdateText.trim() && files.length === 0) return;
    setBusy(true);
    try {
      const uploaded: { url: string; name?: string }[] = [];
      for (const f of files) {
        const url = await uploadOrderAttachment(f);
        if (url) uploaded.push({ url, name: f.name });
      }
      await onSubmitLog(uploaded);
      setFiles([]);
      if (fileInput.current) fileInput.current.value = '';
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-up flex flex-col max-h-[90vh]">
        <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
          <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
            <Clock size={18} /> Order Timeline: {orderNo}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {logs.length === 0 ? (
            <div className="text-center text-slate-400 text-sm">No activity logs found.</div>
          ) : (
            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
              {logs.map((log) => (
                <div key={log.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-100 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 text-slate-500">
                    {log.log_type === 'STATUS_CHANGE' ? <ListTodo size={16} /> : <MessageSquare size={16} />}
                  </div>
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-4 rounded-xl border shadow-sm">
                    <div className="flex items-center justify-between space-x-2 mb-1">
                      <div className="font-bold text-slate-900 text-sm">{log.log_type.replace(/_/g, ' ')}</div>
                      <time className="font-mono text-xs text-slate-400">{new Date(log.created_at).toLocaleString()}</time>
                    </div>
                    {log.message && <div className="text-slate-600 text-sm">{log.message}</div>}
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
          )}
        </div>
        <div className="p-4 bg-white border-t">
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative">
                  <img src={URL.createObjectURL(f)} alt={f.name} className="w-14 h-14 object-cover rounded-lg border" />
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-1.5 -right-1.5 bg-slate-700 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2 items-center">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              title="Attach images"
              className="text-slate-500 hover:text-indigo-600 p-2 rounded-lg border bg-white"
            >
              <ImagePlus size={18} />
            </button>
            <input
              type="text"
              className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none bg-white text-slate-900"
              placeholder="Type a progress update..."
              value={statusUpdateText}
              onChange={e => setStatusUpdateText(e.target.value)}
            />
            <button type="submit" disabled={busy || (!statusUpdateText.trim() && files.length === 0)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
