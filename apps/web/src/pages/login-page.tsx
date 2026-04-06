import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, Lock, Mail } from 'lucide-react';
import { ApiError } from '../lib/api';
import { useAuth } from '../context/auth-context';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.18),transparent_50%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.16),transparent_45%)]" />
      <Card className="relative w-full max-w-md border-slate-200/70 bg-white/90 backdrop-blur">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">Google Sheets Sync</CardTitle>
          <CardDescription>Sign in to manage your sync pipelines and monitor job health.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} className="pl-9" required autoComplete="email" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  className="pl-9"
                  required
                  minLength={8}
                  autoComplete="current-password"
                />
              </div>
            </div>

            {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
