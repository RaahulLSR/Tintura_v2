
import React, { useState, createContext, useContext, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { UserRole, AppUser } from '../types';
import { AIChatPanel } from './AIChatPanel';
import { TinturaLogo } from './Brand';
import { loadToggles, isEnabled, FLAGS } from '../services/featureToggles';
import { loadSettings } from '../services/appSettings';
import { 
  LayoutDashboard, 
  Factory, 
  ClipboardCheck, 
  Package, 
  ShoppingCart, 
  Archive, 
  LogOut, 
  Menu,
  X,
  UserCircle,
  BookOpen,
  Image as ImageIcon,
  ShieldCheck
} from 'lucide-react';

interface AuthContextType {
  isAuthenticated: boolean;
  user: AppUser | null;
  login: (user: AppUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ 
  isAuthenticated: false, 
  user: null, 
  login: () => {}, 
  logout: () => {} 
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const stored = localStorage.getItem('tintura_user');
    if (stored) {
      setUser(JSON.parse(stored));
    }
  }, []);

  const login = (userData: AppUser) => {
    setUser(userData);
    localStorage.setItem('tintura_user', JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('tintura_user');
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!user, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

interface SidebarItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ to, icon, label, active }) => (
  <Link 
    to={to} 
    className={`flex items-center space-x-3 px-3.5 py-2.5 rounded-lg transition-colors text-sm ${
      active ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 font-medium'
    }`}
  >
    {icon}
    <span>{label}</span>
  </Link>
);

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout, isAuthenticated } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [aiChatOn, setAiChatOn] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      loadToggles().then(() => setAiChatOn(isEnabled(FLAGS.AI_CHAT)));
      loadSettings();
    }
  }, [isAuthenticated]);

  if (!isAuthenticated || !user) {
    return <>{children}</>;
  }

  const allNavItems = [
    { roles: [UserRole.ADMIN], to: '/', icon: <LayoutDashboard size={20} />, label: 'Admin HQ' },
    { roles: [UserRole.ADMIN, UserRole.TECH_MANAGER, UserRole.MANAGER], to: '/styles', icon: <BookOpen size={20} />, label: 'Style DB' },
    { roles: [UserRole.ADMIN, UserRole.MANAGER], to: '/subunit', icon: <Factory size={20} />, label: 'Sub-Unit Ops' },
    { roles: [UserRole.ADMIN, UserRole.ACCESSORIES_MANAGER, UserRole.MANAGER], to: '/materials', icon: <Archive size={20} />, label: 'Materials' },
    { roles: [UserRole.ADMIN, UserRole.ACCOUNTS_INVENTORY, UserRole.MANAGER], to: '/inventory', icon: <Package size={20} />, label: 'Inventory' },
    { roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTS_INVENTORY], to: '/sales', icon: <ShoppingCart size={20} />, label: 'Sales' },
    { roles: [UserRole.ADMIN, UserRole.TECH_MANAGER, UserRole.MANAGER], to: '/posters', icon: <ImageIcon size={20} />, label: 'Posters' },
    { roles: [UserRole.ADMIN, UserRole.TECH_MANAGER], to: '/control', icon: <ShieldCheck size={20} />, label: 'Control Center' },
  ];

  const navItems = allNavItems.filter(item =>
    user.role === UserRole.ADMIN || item.roles.includes(user.role)
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0`}>
        <div className="flex flex-col p-5 border-b border-slate-200">
          <div className="flex items-center justify-between mb-1">
            <TinturaLogo className="text-base" subtitle="SST" />
            <button onClick={() => setMobileMenuOpen(false)} className="md:hidden text-slate-400">
                <X size={24} />
            </button>
          </div>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold ml-1 mt-2">A Product of LSR</p>
        </div>
        <nav className="p-3 space-y-1">
          {navItems.map((item) => (
             <SidebarItem key={item.to} to={item.to} icon={item.icon} label={item.label} active={location.pathname === item.to} />
          ))}
        </nav>
        <div className="absolute bottom-0 w-full p-3 border-t border-slate-200 bg-white">
          <div className="flex items-center space-x-3 mb-3 px-1">
             <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center text-brand-600 border border-brand-100">
               <UserCircle size={22}/>
             </div>
             <div className="text-sm overflow-hidden flex-1">
               <p className="text-slate-900 font-bold truncate">{user.full_name || user.username}</p>
               <p className="text-xs text-slate-500 capitalize">{user.role.replace(/_/g, ' ').toLowerCase()}</p>
             </div>
          </div>
          <button onClick={logout} className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg transition-colors text-sm font-semibold">
            <LogOut size={16}/> Sign Out
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-slate-200 p-4 md:hidden flex items-center justify-between">
            <button onClick={() => setMobileMenuOpen(true)} className="text-slate-600"><Menu size={24} /></button>
            <TinturaLogo className="text-sm" subtitle="SST" />
            <span className="w-6" />
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-8">
          {children}
        </main>
      </div>
      {aiChatOn && <AIChatPanel />}
    </div>
  );
};
