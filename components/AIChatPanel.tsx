import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, Loader2, ShieldAlert, Check, Ban, Sparkles, Mic, MicOff } from 'lucide-react';
import { useAuth } from './Layout';
import { UserRole } from '../types';
import {
  AgentState,
  newConversation,
  sendUserMessage,
  approvePending,
  rejectPending,
  isAIConfigured,
} from '../services/geminiService';
import { ToolContext } from '../services/ai/toolRegistry';
import { isEnabled, FLAGS } from '../services/featureToggles';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface Pending {
  tool: string;
  args: Record<string, any>;
  summary: string;
}

export const AIChatPanel: React.FC = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState<'en-IN' | 'ta-IN'>('en-IN');
  const recognitionRef = useRef<any>(null);
  const sendTextRef = useRef<(t: string) => void>(() => {});
  const finalTranscriptRef = useRef('');
  const stateRef = useRef<AgentState>(newConversation());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending, busy]);

  if (!user) return null;

  const ctx: ToolContext = { actor: user.username, role: user.role as UserRole, source: 'human' };

  const applyResponse = (resp: Awaited<ReturnType<typeof sendUserMessage>>) => {
    stateRef.current = resp.state;
    if (resp.error) {
      setMessages((m) => [...m, { role: 'assistant', text: `⚠️ ${resp.error}` }]);
      setPending(null);
    } else if (resp.pendingApproval) {
      setPending({
        tool: resp.pendingApproval.tool,
        args: resp.pendingApproval.args,
        summary: resp.pendingApproval.summary,
      });
    } else if (resp.text) {
      setMessages((m) => [...m, { role: 'assistant', text: resp.text! }]);
      setPending(null);
    }
  };

  const sendText = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const resp = await sendUserMessage(stateRef.current, text, ctx);
      applyResponse(resp);
    } finally {
      setBusy(false);
    }
  };
  // Keep the latest sendText reachable from the speech-recognition callbacks
  // (which capture an older render) so voice can auto-send reliably.
  sendTextRef.current = sendText;

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendText(text);
  };

  const handleApprove = async () => {
    if (!pending) return;
    setBusy(true);
    setMessages((m) => [...m, { role: 'assistant', text: `✅ Approved: ${pending.tool}` }]);
    const wasPending = pending;
    setPending(null);
    try {
      const resp = await approvePending(stateRef.current, ctx);
      applyResponse(resp);
    } catch {
      setPending(wasPending);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!pending) return;
    setBusy(true);
    setMessages((m) => [...m, { role: 'assistant', text: `🚫 Declined: ${pending.tool}` }]);
    setPending(null);
    try {
      const resp = await rejectPending(stateRef.current, ctx);
      applyResponse(resp);
    } finally {
      setBusy(false);
    }
  };

  const configured = isAIConfigured();
  const voiceOn = isEnabled(FLAGS.AI_VOICE);

  const toggleMic = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert('Voice input is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    finalTranscriptRef.current = '';
    rec.onresult = (e: any) => {
      let finalTxt = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTxt += t;
        else interim += t;
      }
      finalTranscriptRef.current = finalTxt;
      setInput((finalTxt + interim).trim());
    };
    rec.onend = () => {
      setListening(false);
      const txt = finalTranscriptRef.current.trim();
      finalTranscriptRef.current = '';
      if (txt) {
        // Auto-send through the full agent pipeline (same as the bot flow).
        setInput('');
        sendTextRef.current(txt);
      }
    };
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-full bg-gradient-to-br from-indigo-600 to-cyan-500 px-5 py-3 text-white shadow-lg shadow-indigo-900/30 hover:scale-105 transition-transform"
          title="Tintura Assistant"
        >
          <Sparkles size={20} />
          <span className="font-semibold hidden sm:inline">Assistant</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-0 right-0 sm:bottom-6 sm:right-6 z-[60] flex h-[80vh] w-full sm:h-[600px] sm:w-[400px] flex-col overflow-hidden rounded-none sm:rounded-2xl border border-slate-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 p-1.5">
                <Bot size={18} />
              </div>
              <div className="leading-tight">
                <p className="font-bold text-sm">Tintura Assistant</p>
                <p className="text-[10px] text-slate-400 capitalize">
                  {user.role.replace(/_/g, ' ').toLowerCase()} • AI
                </p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
              <X size={20} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
            {!configured && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                Gemini API key not found. Add <code>VITE_GEMINI_API_KEY</code> to your .env and
                restart the dev server.
              </div>
            )}
            {messages.length === 0 && configured && (
              <div className="mt-8 text-center text-slate-400 text-sm">
                <Sparkles className="mx-auto mb-2 text-indigo-400" size={28} />
                Ask about orders, styles, material forecasts, or request actions.
                <div className="mt-3 text-xs text-slate-400">
                  e.g. "List in-progress orders" · "Forecast materials for ORD-12"
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {/* Approval card */}
            {pending && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-sm">
                <div className="flex items-center gap-2 text-amber-800">
                  <ShieldAlert size={16} />
                  <span className="text-sm font-bold">Approval required</span>
                </div>
                <p className="mt-1 text-xs text-amber-900">{pending.summary}</p>
                <div className="mt-2 rounded-lg bg-white/70 p-2 font-mono text-[11px] text-slate-600">
                  {pending.tool}({JSON.stringify(pending.args)})
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleApprove}
                    disabled={busy}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check size={14} /> Approve
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={busy}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-200 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                  >
                    <Ban size={14} /> Decline
                  </button>
                </div>
              </div>
            )}

            {busy && (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 size={16} className="animate-spin" /> Thinking…
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-slate-200 bg-white p-3">
            {voiceOn && (
              <div className="mb-2 flex items-center gap-1">
                <button
                  onClick={() => setLang('en-IN')}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${lang === 'en-IN' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}
                >
                  EN / Tanglish
                </button>
                <button
                  onClick={() => setLang('ta-IN')}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${lang === 'ta-IN' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}
                >
                  தமிழ்
                </button>
                {listening && <span className="text-[10px] text-red-500 font-semibold animate-pulse">● listening… (auto-send)</span>}
              </div>
            )}
            <div className="flex items-end gap-2">
              {voiceOn && (
                <button
                  onClick={toggleMic}
                  disabled={!configured || busy}
                  title="Voice input"
                  className={`rounded-xl p-2.5 text-white disabled:opacity-40 ${listening ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-slate-600 hover:bg-slate-700'}`}
                >
                  {listening ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                placeholder={configured ? 'Message the assistant…' : 'AI not configured'}
                disabled={!configured || busy}
                className="max-h-28 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
              />
              <button
                onClick={handleSend}
                disabled={!configured || busy || !input.trim()}
                className="rounded-xl bg-indigo-600 p-2.5 text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
