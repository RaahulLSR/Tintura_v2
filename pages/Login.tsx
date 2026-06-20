
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../components/Layout';
import { TinturaLogo, TinturaSeal } from '../components/Brand';
import { authenticateUser } from '../services/db';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await authenticateUser(username, password);
      
      if (user) {
        login(user);
        // Force navigation by role for immediate effect.
        if (user.role === 'MANAGER') navigate('/subunit');
        else if (user.role === 'ACCESSORIES_MANAGER') navigate('/materials');
        else if (user.role === 'ACCOUNTS_INVENTORY') navigate('/inventory');
        else if (user.role === 'TECH_MANAGER') navigate('/control');
        else navigate('/');
      } else {
        setError('Invalid credentials. Please check your username and password.');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl flex w-full max-w-4xl overflow-hidden animate-scale-up">
        
        {/* Left Side: Branding */}
        <div className="w-1/2 bg-brand-600 text-white p-12 hidden md:flex flex-col justify-between relative overflow-hidden">
          <div className="relative z-10">
            <div className="mb-6">
                 <TinturaLogo className="text-2xl" onDark subtitle="" />
                 <p className="text-white/70 font-bold tracking-[0.3em] text-xs mt-3 ml-1">SST · MANUFACTURING</p>
            </div>
            <p className="text-indigo-100 text-lg leading-relaxed">
              Advanced Manufacturing Execution System. <br/>
              Streamlining operations from order to delivery.
            </p>
          </div>
          
          <div className="relative z-10 flex items-end justify-between">
             <div>
               <div className="h-px w-16 bg-white/40 mb-4"></div>
               <p className="text-sm font-semibold text-indigo-200 uppercase tracking-widest">A Product of LSR</p>
             </div>
             <TinturaSeal size={64} inverse />
          </div>

          {/* Decorative BG */}
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-white rounded-full mix-blend-overlay filter blur-3xl opacity-20"></div>
          <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 bg-indigo-300 rounded-full mix-blend-overlay filter blur-3xl opacity-20"></div>
        </div>

        {/* Right Side: Form */}
        <div className="w-full md:w-1/2 p-12 flex flex-col justify-center">
          <div className="mb-8 text-center md:text-left">
            <div className="md:hidden mb-6 flex justify-center">
              <TinturaLogo className="text-xl" subtitle="SST" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Welcome Back</h2>
            <p className="text-slate-500">Please enter your credentials to access the workspace.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Username</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="text-slate-400" size={20} />
                </div>
                <input 
                  type="text" 
                  required
                  className="input pl-10"
                  placeholder="Enter your username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="text-slate-400" size={20} />
                </div>
                <input 
                  type="password" 
                  required
                  className="input pl-10"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-600"></div>
                {error}
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-brand-600 text-white py-3 rounded-xl font-bold hover:bg-brand-700 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading ? <Loader2 className="animate-spin" /> : <>Sign In <ArrowRight size={20} /></>}
            </button>
          </form>

          <div className="mt-8 text-center text-xs text-slate-400">
             &copy; {new Date().getFullYear()} Tintura SST. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
};
