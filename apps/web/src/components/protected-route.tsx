import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/auth-context';

type ProtectedRouteProps = {
  children: JSX.Element;
};

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <p style={{ padding: '1rem' }}>Loading...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
