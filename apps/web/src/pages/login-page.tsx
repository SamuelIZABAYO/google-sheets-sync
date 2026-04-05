import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../context/auth-context';

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();

  const redirectPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  if (user) {
    return <Navigate to={redirectPath} replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email.trim(), password);
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        setError(submitError.message);
      } else {
        setError('Unable to login right now');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '8rem auto', padding: '1rem', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Automation Glass Dashboard</h1>
      <p style={{ color: '#555', marginBottom: '1.25rem' }}>Sign in with your account to continue.</p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
        <label>
          Email
          <input
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            type="email"
            required
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          />
        </label>

        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            type="password"
            required
            minLength={8}
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          />
        </label>

        {error ? <p role="alert" style={{ color: '#b00020' }}>{error}</p> : null}

        <button type="submit" disabled={submitting} style={{ padding: '0.65rem 1rem' }}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
