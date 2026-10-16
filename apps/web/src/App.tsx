import { useEffect, useState, type FormEvent } from 'react';

interface Owner {
  id: number;
  username: string;
}

async function getOwner(): Promise<Owner | null> {
  const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Could not contact the server');
  const data = await response.json() as { owner: Owner };
  return data.owner;
}

export function App() {
  const [owner, setOwner] = useState<Owner | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void getOwner()
      .then((current) => { if (active) setOwner(current); })
      .catch(() => { if (active) setError('Server unavailable. Try refreshing the page.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ password })
      });
      if (!response.ok) {
        setError(response.status === 429 ? 'Too many attempts. Try again shortly.' : 'Incorrect password.');
        return;
      }
      const data = await response.json() as { owner: Owner };
      setOwner(data.owner);
      setPassword('');
    } catch {
      setError('Could not contact the server.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onLogout() {
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error();
      setOwner(null);
    } catch {
      setError('Sign out failed. Please retry.');
    }
  }

  if (loading) {
    return <main className="loading-screen" aria-live="polite">Opening your workspace…</main>;
  }

  if (!owner) {
    return (
      <main className="login-screen">
        <section className="login-panel" aria-labelledby="login-heading">
          <div className="mark" aria-hidden="true">N</div>
          <p className="eyebrow">YOUR PERSONAL WORKSPACE</p>
          <h1 id="login-heading">Welcome back.</h1>
          <p className="muted">Your notes, reading, and research — all in one place.</p>
          <form onSubmit={(event) => { void onLogin(event); }}>
            <label htmlFor="password">Owner password</label>
            <input id="password" name="password" type="password" autoComplete="current-password"
              required value={password} onChange={(event) => setPassword(event.target.value)}
              disabled={submitting} autoFocus />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="login-footnote">First time here? Create the owner account using the setup command in the README.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-title"><span className="mark small" aria-hidden="true">N</span><strong>NotetakingApp</strong></div>
        <div className="sidebar-section"><p className="eyebrow">LIBRARY</p><p className="sidebar-empty">Folders and notes will appear here in Slice 1.</p></div>
        <div className="sidebar-bottom"><span className="user-indicator">Signed in as {owner.username}</span>
          <button type="button" className="text-button" onClick={() => { void onLogout(); }}>Sign out</button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-toolbar"><span>Workspace</span><span className="stage-label">FOUNDATION</span></header>
        <section className="empty-state">
          <div className="empty-icon" aria-hidden="true">✎</div>
          <p className="eyebrow">A PLACE TO THINK</p>
          <h1>Make space for your ideas.</h1>
          <p className="muted">The foundation is ready. Folders, notes, and the spatial page editor are coming in the next slices.</p>
        </section>
        {error && <p className="toast-error" role="alert">{error}</p>}
      </main>
    </div>
  );
}
