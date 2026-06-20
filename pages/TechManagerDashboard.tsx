import React, { useEffect, useState } from 'react';
import {
  SlidersHorizontal,
  History,
  Trash2,
  RotateCcw,
  Undo2,
  Loader2,
  ShieldCheck,
  Bot,
  Save,
  CheckCircle2,
  AlertCircle,
  Users,
  Send,
} from 'lucide-react';
import { useAuth } from '../components/Layout';
import { FeatureToggle, ActivityRecord, DustbinRecord, AppUser } from '../types';
import { fetchToggles, setToggle, FLAGS } from '../services/featureToggles';
import { fetchActivity, undoActivity } from '../services/activityLog';
import { fetchDustbin, restoreFromDustbin } from '../services/dustbin';
import { fetchSettings, setSetting, SETTINGS } from '../services/appSettings';
import { fetchAppUsers, setUserTelegramChatId } from '../services/db';
import { accessSummary } from '../services/botAccess';

type Tab = 'toggles' | 'users' | 'activity' | 'dustbin' | 'ai';

const FLAG_LABELS: Record<string, string> = {
  [FLAGS.AI_CHAT]: 'AI Chat Assistant',
  [FLAGS.AI_WRITES]: 'AI Can Write Data',
  [FLAGS.AI_VOICE]: 'Voice Input (Speech-to-Text)',
  [FLAGS.TECH_MANAGER_AI]: 'Tech Manager AI (meta)',
  [FLAGS.TELEGRAM_BOT]: 'Telegram Bot',
  [FLAGS.WHATSAPP_BOT]: 'WhatsApp Bot',
};

const riskBadge = (risk?: string) => {
  const map: Record<string, string> = {
    high: 'bg-red-100 text-red-700',
    low: 'bg-amber-100 text-amber-700',
    read: 'bg-slate-100 text-slate-600',
  };
  return map[risk || 'low'] || 'bg-slate-100 text-slate-600';
};

export const TechManagerDashboard: React.FC = () => {
  const { user } = useAuth();
  const actor = user?.full_name || user?.username || 'Tech Manager';
  const [tab, setTab] = useState<Tab>('toggles');

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-gradient-to-br from-indigo-600 to-cyan-500 p-2.5 rounded-xl text-white shadow-lg">
          <ShieldCheck size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Tech Manager Control Center</h1>
          <p className="text-sm text-slate-500">Governance, audit trail & system configuration.</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto">
        <TabButton active={tab === 'toggles'} onClick={() => setTab('toggles')} icon={<SlidersHorizontal size={16} />} label="Feature Toggles" />
        <TabButton active={tab === 'users'} onClick={() => setTab('users')} icon={<Users size={16} />} label="Telegram Access" />
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')} icon={<History size={16} />} label="Activity Registry" />
        <TabButton active={tab === 'dustbin'} onClick={() => setTab('dustbin')} icon={<Trash2 size={16} />} label="Dustbin" />
        <TabButton active={tab === 'ai'} onClick={() => setTab('ai')} icon={<Bot size={16} />} label="AI Settings" />
      </div>

      {tab === 'toggles' && <TogglesSection actor={actor} />}
      {tab === 'users' && <TelegramAccessSection actor={actor} />}
      {tab === 'activity' && <ActivitySection actor={actor} />}
      {tab === 'dustbin' && <DustbinSection actor={actor} />}
      {tab === 'ai' && <AISettingsSection actor={actor} />}
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({
  active,
  onClick,
  icon,
  label,
}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
      active ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
    }`}
  >
    {icon}
    {label}
  </button>
);

// ---------------------------------------------------------------- Toggles
const TogglesSection: React.FC<{ actor: string }> = ({ actor }) => {
  const [toggles, setToggles] = useState<FeatureToggle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setToggles(await fetchToggles());
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const flip = async (t: FeatureToggle) => {
    setSaving(t.key);
    await setToggle(t.key, !t.enabled, actor);
    await load();
    setSaving(null);
  };

  if (loading) return <Spinner />;

  return (
    <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
      {toggles.length === 0 && <Empty text="No feature toggles found. Run the SQL seed in Supabase." />}
      {toggles.map((t) => (
        <div key={t.key} className="flex items-center justify-between p-4">
          <div>
            <p className="font-semibold text-slate-800">{FLAG_LABELS[t.key] || t.key}</p>
            <p className="text-xs text-slate-400 font-mono">{t.key}</p>
            {t.updated_by && (
              <p className="text-[11px] text-slate-400 mt-0.5">Last changed by {t.updated_by}</p>
            )}
          </div>
          <button
            onClick={() => flip(t)}
            disabled={saving === t.key}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              t.enabled ? 'bg-emerald-500' : 'bg-slate-300'
            } disabled:opacity-50`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                t.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      ))}
    </div>
  );
};

// ------------------------------------------------------- Telegram Access
const TelegramAccessSection: React.FC<{ actor: string }> = ({ actor }) => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [botOn, setBotOn] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [savingBot, setSavingBot] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [us, toggles] = await Promise.all([fetchAppUsers(), fetchToggles()]);
    setUsers(us);
    setDrafts(Object.fromEntries(us.map((u) => [String(u.id), u.telegram_chat_id || ''])));
    setBotOn(!!toggles.find((t) => t.key === FLAGS.TELEGRAM_BOT)?.enabled);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const flipBot = async () => {
    setSavingBot(true);
    await setToggle(FLAGS.TELEGRAM_BOT, !botOn, actor);
    setBotOn((v) => !v);
    setSavingBot(false);
  };

  const saveChatId = async (u: AppUser) => {
    const id = String(u.id);
    setSavingId(id);
    setMsg(null);
    const res = await setUserTelegramChatId(u.id, drafts[id] ?? '');
    if (res.success) {
      setMsg({ ok: true, text: `Saved chat ID for ${u.username}.` });
      await load();
    } else {
      setMsg({ ok: false, text: res.error || 'Could not save (chat ID may already be linked to another user).' });
    }
    setSavingId(null);
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      {/* Bot on/off */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-800 flex items-center gap-2"><Send size={16} /> Telegram channel</p>
          <p className="text-sm text-slate-500">
            When off, the bot stops responding to everyone (no menus, lookups, POs or PDFs are sent).
          </p>
        </div>
        <button
          onClick={flipBot}
          disabled={savingBot}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            botOn ? 'bg-emerald-500' : 'bg-slate-300'
          } disabled:opacity-50`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              botOn ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 rounded-lg p-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {msg.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Link each user to their Telegram chat ID. The bot then shows only the actions their role is
        allowed to use. Tip: ask the person to open the bot and send <span className="font-mono font-semibold">/id</span> —
        it replies with their chat ID. Paste it here. Leave blank to revoke access.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-max">
          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-left">
            <tr>
              <th className="p-3">User</th>
              <th className="p-3">Role</th>
              <th className="p-3">Bot access</th>
              <th className="p-3">Telegram chat ID</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400">No users found. Run the SQL seed in Supabase.</td></tr>
            )}
            {users.map((u) => {
              const id = String(u.id);
              const dirty = (drafts[id] ?? '') !== (u.telegram_chat_id || '');
              return (
                <tr key={id} className="align-top">
                  <td className="p-3">
                    <div className="font-semibold text-slate-800">{u.full_name || u.username}</div>
                    <div className="text-xs text-slate-400 font-mono">@{u.username}</div>
                  </td>
                  <td className="p-3">
                    <span className="inline-block rounded bg-indigo-50 text-indigo-700 px-2 py-0.5 text-xs font-semibold">{u.role}</span>
                  </td>
                  <td className="p-3 max-w-xs text-xs text-slate-500">{accessSummary(u.role)}</td>
                  <td className="p-3">
                    <input
                      value={drafts[id] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
                      placeholder="e.g. 123456789"
                      inputMode="numeric"
                      className="w-40 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => saveChatId(u)}
                      disabled={!dirty || savingId === id}
                      className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                    >
                      {savingId === id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --------------------------------------------------------------- Activity
const ActivitySection: React.FC<{ actor: string }> = ({ actor }) => {
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setRecords(await fetchActivity(100));
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const undo = async (id: string) => {
    setBusy(id);
    setMsg(null);
    const res = await undoActivity(id);
    setMsg(res.success ? { ok: true, text: 'Action reverted.' } : { ok: false, text: res.error || 'Undo failed.' });
    await load();
    setBusy(null);
  };

  const canUndo = (r: ActivityRecord) =>
    !r.undone && r.action !== 'undo' && (r.before !== null || r.after !== null);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`flex items-center gap-2 rounded-lg p-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {msg.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {records.length === 0 && <Empty text="No activity recorded yet." />}
        {records.map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${riskBadge(r.risk)}`}>{r.risk}</span>
                <span className="text-[10px] font-bold uppercase text-slate-400">{r.source}</span>
                <span className="font-semibold text-slate-800 text-sm">{r.action}</span>
                {r.undone && <span className="text-[10px] font-bold text-slate-400">(UNDONE)</span>}
              </div>
              <p className="text-sm text-slate-600 mt-0.5 truncate">{r.summary}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {r.actor} · {r.entity_table} · {r.created_at ? new Date(r.created_at).toLocaleString() : ''}
              </p>
            </div>
            {canUndo(r) && (
              <button
                onClick={() => undo(r.id)}
                disabled={busy === r.id}
                className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50 shrink-0"
              >
                {busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Dustbin
const DustbinSection: React.FC<{ actor: string }> = ({ actor }) => {
  const [items, setItems] = useState<DustbinRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setItems(await fetchDustbin());
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const restore = async (id: string) => {
    setBusy(id);
    await restoreFromDustbin(id, actor);
    await load();
    setBusy(null);
  };

  if (loading) return <Spinner />;

  return (
    <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
      {items.length === 0 && <Empty text="Dustbin is empty. Nothing is ever hard-deleted." />}
      {items.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 text-sm capitalize">{d.entity_table}</p>
            <p className="text-[11px] text-slate-400">
              id {d.entity_id} · deleted by {d.deleted_by} ·{' '}
              {d.created_at ? new Date(d.created_at).toLocaleString() : ''}
            </p>
          </div>
          <button
            onClick={() => restore(d.id)}
            disabled={busy === d.id}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0"
          >
            {busy === d.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Restore
          </button>
        </div>
      ))}
    </div>
  );
};

// ------------------------------------------------------------- AI Settings
const AISettingsSection: React.FC<{ actor: string }> = ({ actor }) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const rows = await fetchSettings();
      const found = rows.find((r) => r.key === SETTINGS.AI_SYSTEM_PROMPT);
      setPrompt(found?.value || '');
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    await setSetting(SETTINGS.AI_SYSTEM_PROMPT, prompt, actor);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) return <Spinner />;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="font-semibold text-slate-800 mb-1">Assistant Instructions</h3>
      <p className="text-sm text-slate-500 mb-3">
        Extra rules appended to the AI's base prompt across every channel (chat, Telegram). Use this
        to tune tone, language, or business policy without redeploying.
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={8}
        placeholder="e.g. Always reply in Tanglish. Always confirm quantities before raising a PO. Refer to the MD as 'Boss'."
        className="w-full rounded-lg border border-slate-300 p-3 text-sm font-mono focus:border-indigo-500 focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Instructions
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-emerald-600">
            <CheckCircle2 size={16} /> Saved
          </span>
        )}
      </div>
    </div>
  );
};

const Spinner = () => (
  <div className="flex items-center justify-center p-10 text-slate-400">
    <Loader2 className="animate-spin" />
  </div>
);

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="p-8 text-center text-sm text-slate-400">{text}</div>
);
