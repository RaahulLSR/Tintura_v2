import React, { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Search, Plus, Loader2, Sparkles, ArrowRight } from 'lucide-react';
import { Style, Attachment, POSTER_KEY, getStyleMainImage, getStylePoster } from '../types';
import { fetchStyles, upsertStyle } from '../services/db';
import { PosterEditorModal } from '../components/style-db/PosterEditorModal';

const BLANK_STYLE = (): Style => ({
  style_number: '',
  category: '',
  packing_type: '',
  pcs_per_box: 0,
  style_text: '',
  tech_pack: {},
} as Style);

export const PostersStudio: React.FC = () => {
  const [styles, setStyles] = useState<Style[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<Style | null>(null);

  const load = async () => {
    setLoading(true);
    try { setStyles(await fetchStyles()); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return styles;
    return styles.filter(s =>
      (s.style_number || '').toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q) ||
      (s.garment_type || '').toLowerCase().includes(q));
  }, [styles, search]);

  const handlePosterReady = async (att: Attachment) => {
    if (!active) return;
    // Persist to the chosen style's poster gallery (skip for a blank canvas).
    if (active.style_number) {
      const poster = getStylePoster(active);
      const images = [...poster.images, att];
      const tp: any = { ...(active.tech_pack || {}) };
      tp[POSTER_KEY] = { images, mainUrl: poster.mainUrl || images[0]?.url };
      const updated = { ...active, tech_pack: tp };
      await upsertStyle(updated);
      setActive(updated);
      load();
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title flex items-center gap-2"><Sparkles size={24} className="text-brand-600" /> Poster Studio</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">Pick a style (or start blank), then overlay logos, info boxes &amp; text — fully under your control.</p>
        </div>
        <button onClick={() => setActive(BLANK_STYLE())} className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-black hover:bg-brand-700 shadow-sm">
          <Plus size={16} /> Blank canvas
        </button>
      </div>

      <div className="card p-5">
        <div className="relative mb-4 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by style number, category or garment type…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto mb-3" /><p className="font-bold text-sm">Loading styles…</p></div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-slate-300">
            <ImageIcon size={40} className="mx-auto mb-3 opacity-40" />
            <p className="font-bold text-sm text-slate-400">No styles found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filtered.map(s => {
              const img = getStyleMainImage(s);
              return (
                <button key={s.style_number} onClick={() => setActive(s)} className="group text-left bg-white rounded-2xl border border-slate-200 hover:border-brand-400 hover:shadow-md transition-all overflow-hidden">
                  <div className="aspect-square bg-slate-50 flex items-center justify-center overflow-hidden">
                    {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={32} className="text-slate-200" />}
                  </div>
                  <div className="p-3">
                    <p className="font-black text-slate-700 text-sm truncate">{s.style_number}</p>
                    <p className="text-[11px] text-slate-400 font-semibold truncate">{s.garment_type || s.category || '—'}</p>
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-black text-brand-600 opacity-0 group-hover:opacity-100 transition-opacity">Open editor <ArrowRight size={12} /></span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {active && (
        <PosterEditorModal
          style={active}
          onClose={() => setActive(null)}
          onPosterReady={handlePosterReady}
        />
      )}
    </div>
  );
};
