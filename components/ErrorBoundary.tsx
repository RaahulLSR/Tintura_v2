import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message?: string;
}

/**
 * Catches render-time crashes anywhere in the tree and shows a friendly,
 * actionable recovery screen instead of a blank white page. Keeps the app
 * approachable for non-technical staff who would otherwise be stuck.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface the details in the console for debugging without scaring the user.
    console.error('App crashed:', error, info);
  }

  handleReload = () => {
    // Drop the in-memory error and reload a fresh copy of the app.
    this.setState({ hasError: false, message: undefined });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-xl p-8 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
            <AlertTriangle size={28} />
          </div>
          <h1 className="text-xl font-black text-slate-800 mb-2">Something went wrong</h1>
          <p className="text-sm text-slate-500 mb-1">
            The screen hit an unexpected error. Nothing was lost — just reload to continue.
          </p>
          {this.state.message && (
            <p className="text-xs text-slate-400 mb-5 break-words font-mono bg-slate-50 rounded-lg px-3 py-2 mt-3">
              {this.state.message}
            </p>
          )}
          <button
            onClick={this.handleReload}
            className="mt-2 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95"
          >
            <RefreshCcw size={18} /> Reload the app
          </button>
        </div>
      </div>
    );
  }
}
