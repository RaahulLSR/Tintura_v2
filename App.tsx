
import React from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, Layout, useAuth } from './components/Layout';
import { AdminDashboard } from './pages/AdminDashboard';
import { SubunitDashboard } from './pages/SubunitDashboard';
import { MaterialsDashboard } from './pages/MaterialsDashboard';
import { InventoryDashboard } from './pages/InventoryDashboard';
import { SalesDashboard } from './pages/SalesDashboard';
import { StyleDatabase } from './pages/StyleDatabase';
import { PostersStudio } from './pages/PostersStudio';
import { TechManagerDashboard } from './pages/TechManagerDashboard';
import { Login } from './pages/Login';
import { UserRole } from './types';

// Where each role lands when it hits a page it cannot access.
const homeForRole = (role: UserRole): string => {
    switch (role) {
        case UserRole.ADMIN: return '/';
        case UserRole.TECH_MANAGER: return '/control';
        case UserRole.MANAGER: return '/subunit';
        case UserRole.ACCESSORIES_MANAGER: return '/materials';
        case UserRole.ACCOUNTS_INVENTORY: return '/inventory';
        default: return '/';
    }
};

const ProtectedRoute: React.FC<{ children: React.ReactNode, allowedRoles?: UserRole[] }> = ({ children, allowedRoles }) => {
    const { isAuthenticated, user } = useAuth();
    const location = useLocation();

    if (!isAuthenticated || !user) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (allowedRoles && !allowedRoles.includes(user.role) && user.role !== UserRole.ADMIN) {
        return <Navigate to={homeForRole(user.role)} replace />;
    }

    return <>{children}</>;
};

const AppRoutes = () => {
    return (
        <Layout>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            <Route path="/" element={
                <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                    <AdminDashboard />
                </ProtectedRoute>
            } />

            <Route path="/styles" element={
                <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.TECH_MANAGER, UserRole.MANAGER]}>
                    <StyleDatabase />
                </ProtectedRoute>
            } />
            
            <Route path="/subunit" element={
                <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER]}>
                    <SubunitDashboard />
                </ProtectedRoute>
            } />
            
            <Route path="/materials" element={
                <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.ACCESSORIES_MANAGER, UserRole.MANAGER]}>
                    <MaterialsDashboard />
                </ProtectedRoute>
            } />
            
            <Route path="/inventory" element={
                <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.ACCOUNTS_INVENTORY, UserRole.MANAGER]}>
                    <InventoryDashboard />
                </ProtectedRoute>
            } />
            
            <Route path="/sales" element={
                <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTS_INVENTORY]}>
                    <SalesDashboard />
                </ProtectedRoute>
            } />
            
            <Route path="/posters" element={
                <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.TECH_MANAGER, UserRole.MANAGER]}>
                    <PostersStudio />
                </ProtectedRoute>
            } />
            
            <Route path="/control" element={
                <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.TECH_MANAGER]}>
                    <TechManagerDashboard />
                </ProtectedRoute>
            } />
            
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Layout>
    )
}

const App: React.FC = () => {
  return (
    <HashRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </HashRouter>
  );
};

export default App;
