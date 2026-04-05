import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/auth-context';
import { ProtectedRoute } from './components/protected-route';
import { LoginPage } from './pages/login-page';
import { DashboardPage } from './pages/dashboard-page';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
