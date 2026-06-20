
import React, { useState } from 'react';
import { ExternalLink, FileText, Download, Eye } from 'lucide-react';
import { Attachment } from '../../types';
import { AttachmentPreview } from './AttachmentPreview';

export const AttachmentGallery: React.FC<{ attachments: Attachment[] }> = ({ attachments }) => {
  const images = attachments.filter(a => a.type === 'image');
  const docs = attachments.filter(a => a.type === 'document');
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {images.map((img, idx) => (
            <button key={idx} type="button" onClick={() => setPreview(attachments.indexOf(img))} className="relative group/img aspect-[4/3] rounded-2xl overflow-hidden border border-slate-200 shadow-sm block bg-slate-50">
              <img src={img.url} className="w-full h-full object-contain transition-transform group-hover/img:scale-105" alt={img.name}/>
              <div className="absolute inset-0 bg-indigo-900/60 opacity-0 group-hover/img:opacity-100 flex items-center justify-center transition-opacity">
                <ExternalLink size={24} className="text-white"/>
              </div>
            </button>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="space-y-2">
          {docs.map((doc, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl hover:border-indigo-400 transition-all">
              <button type="button" onClick={() => setPreview(attachments.indexOf(doc))} className="flex items-center gap-2 truncate pr-4 flex-1 text-left">
                <FileText size={16} className="text-indigo-500"/>
                <span className="text-xs font-bold text-slate-700 truncate">{doc.name}</span>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => setPreview(attachments.indexOf(doc))} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all" title="Preview"><Eye size={16}/></button>
                <a href={doc.url} target="_blank" rel="noreferrer" download={doc.name} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all" title="Download"><Download size={16}/></a>
              </div>
            </div>
          ))}
        </div>
      )}
      {preview !== null && (
        <AttachmentPreview attachments={attachments} startIndex={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
