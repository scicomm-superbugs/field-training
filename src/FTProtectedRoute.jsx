import { Navigate, Outlet, useOutletContext } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

export default function FTProtectedRoute({ requireRole = [] }) {
  const { user, loading } = useAuth();
  const context = useOutletContext(); // Crucial fix for nested routes forwarding

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60dvh' }}>
        <div style={{ textAlign: 'center', color: 'var(--ft-text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem', animation: 'ftPulse 1.5s infinite' }}>🔬</div>
          <div style={{ fontWeight: 600 }}>Verifying Access...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireRole.length > 0) {
    const userRole = user.role || 'student';
    if (userRole !== 'master' && userRole !== 'admin' && !requireRole.includes(userRole)) {
      return <Navigate to="/" replace />;
    }
  }

  return <Outlet context={context} />;
}
