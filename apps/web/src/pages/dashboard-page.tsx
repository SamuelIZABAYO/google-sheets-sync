import { Link } from 'react-router-dom';
import { useAuth } from '../context/auth-context';

const navItems = [
  { label: 'Overview', href: '#' },
  { label: 'Sync Jobs', href: '#' },
  { label: 'Activity', href: '#' },
  { label: 'Settings', href: '#' }
] as const;

export function DashboardPage() {
  const { user, logout } = useAuth();

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '220px 1fr', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <aside style={{ borderRight: '1px solid #e2e8f0', padding: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Dashboard</h2>
        <nav style={{ display: 'grid', gap: '0.5rem' }}>
          {navItems.map((item) => (
            <a key={item.label} href={item.href} style={{ color: '#1f2937', textDecoration: 'none' }}>
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <section style={{ padding: '1.5rem' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ marginBottom: '0.25rem' }}>Welcome back</h1>
            <p style={{ margin: 0, color: '#555' }}>{user?.email}</p>
          </div>
          <button type="button" onClick={logout} style={{ padding: '0.5rem 0.75rem' }}>
            Log out
          </button>
        </header>

        <article style={{ marginTop: '1.5rem', border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Getting started</h3>
          <p>This is the initial dashboard shell. Upcoming tasks will wire job creation, run history, and sync controls.</p>
          <p>
            Need to configure OAuth? Visit <Link to="/login">login</Link> to re-authenticate.
          </p>
        </article>
      </section>
    </div>
  );
}
