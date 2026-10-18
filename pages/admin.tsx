import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import '../src/styles/maple.css';
import '../src/styles/admin.css';

interface FameReport {
  id: string;
  at: number;
  reporterName: string;
  reporterIp: string;
  targetId: string;
  targetName: string;
  targetIp: string;
  reason: string;
  targetFame?: number;
  recentMessages?: { at: number; text: string }[];
}

interface FameBan {
  ip: string;
  reason: string;
  by: string;
  at: number;
}

const formatTime = (at: number): string => new Date(at).toLocaleString();

const fameTone = (fame: number | undefined): string => {
  const value = fame ?? 0;
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return '';
};

export default function AdminPage() {
  const [signedIn, setSignedIn] = createSignal<boolean | null>(null);
  const [password, setPassword] = createSignal('');
  const [authError, setAuthError] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);

  const [reports, setReports] = createSignal<FameReport[]>([]);
  const [bans, setBans] = createSignal<FameBan[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [status, setStatus] = createSignal('');

  const [manualIp, setManualIp] = createSignal('');
  const [manualReason, setManualReason] = createSignal('');

  const bannedIps = createMemo(() => new Set(bans().map((ban) => ban.ip)));

  /** Admin fetch. A 401 means the session expired or was never valid. */
  const api = async (path: string, init?: RequestInit): Promise<any> => {
    const response = await fetch(path, { credentials: 'same-origin', ...init });
    if (response.status === 401) {
      setSignedIn(false);
      throw new Error('unauthorized');
    }
    if (!response.ok) throw new Error(`request failed: ${response.status}`);
    if (response.status === 204) return null;
    return response.json();
  };

  const load = async () => {
    setLoading(true);
    try {
      const [reportData, banData] = await Promise.all([
        api('/api/admin/reports'),
        api('/api/admin/bans'),
      ]);
      setReports(reportData.reports ?? []);
      setBans(banData.bans ?? []);
    } catch (error) {
      if (!(error instanceof Error && error.message === 'unauthorized')) {
        setStatus('Could not load moderation data.');
      }
    } finally {
      setLoading(false);
    }
  };

  onMount(async () => {
    try {
      const session = await api('/api/admin/session');
      setSignedIn(Boolean(session?.signedIn));
      if (session?.signedIn) await load();
    } catch {
      setSignedIn(false);
    }
  });

  const signIn = async (event: Event) => {
    event.preventDefault();
    setSubmitting(true);
    setAuthError('');
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password() }),
      });
      if (response.ok) {
        setPassword('');
        setSignedIn(true);
        await load();
      } else {
        setAuthError(
          response.status === 401 ? 'Incorrect password.' : 'Sign-in failed.',
        );
      }
    } catch {
      setAuthError('Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    await fetch('/api/admin/session', {
      method: 'DELETE',
      credentials: 'same-origin',
    }).catch(() => {});
    setSignedIn(false);
    setReports([]);
    setBans([]);
  };

  const banIp = async (ip: string, reason: string) => {
    if (!ip) {
      setStatus('That report has no IP to ban.');
      return;
    }
    try {
      await api('/api/admin/bans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, reason }),
      });
      setStatus(`Banned ${ip}.`);
      await load();
    } catch (error) {
      if (!(error instanceof Error && error.message === 'unauthorized')) {
        setStatus(`Could not ban ${ip}.`);
      }
    }
  };

  const unbanIp = async (ip: string) => {
    try {
      await api(`/api/admin/bans?ip=${encodeURIComponent(ip)}`, {
        method: 'DELETE',
      });
      setStatus(`Unbanned ${ip}.`);
      await load();
    } catch (error) {
      if (!(error instanceof Error && error.message === 'unauthorized')) {
        setStatus(`Could not unban ${ip}.`);
      }
    }
  };

  const banFromForm = async (event: Event) => {
    event.preventDefault();
    const ip = manualIp().trim();
    if (!ip) return;
    await banIp(ip, manualReason().trim());
    setManualIp('');
    setManualReason('');
  };

  const clearReports = async () => {
    if (!window.confirm('Clear all reports?')) return;
    try {
      await api('/api/admin/reports', { method: 'DELETE' });
      await load();
    } catch {
      /* handled by load/status */
    }
  };

  return (
    <div class="ms-admin-page">
      <Show
        when={signedIn() === true}
        fallback={
          <div class="ms-admin-center">
            <Show when={signedIn() === null} fallback={
              <form class="ms-window ms-admin-login" onSubmit={signIn}>
                <div class="ms-window-titlebar">
                  <span>MAYA'S HOUSE — ADMIN</span>
                </div>
                <div class="ms-admin-login-body">
                  <label class="ms-admin-label" for="admin-password">
                    Admin password
                  </label>
                  <input
                    id="admin-password"
                    class="ms-input"
                    type="password"
                    autocomplete="current-password"
                    value={password()}
                    onInput={(event) => setPassword(event.currentTarget.value)}
                  />
                  <Show when={authError()}>
                    <p class="ms-admin-error">{authError()}</p>
                  </Show>
                  <button
                    type="submit"
                    class="ms-btn ms-btn-gold"
                    disabled={submitting() || !password()}
                  >
                    {submitting() ? 'Signing in…' : 'Sign in'}
                  </button>
                </div>
              </form>
            }>
              <p class="ms-admin-loading">Checking session…</p>
            </Show>
          </div>
        }
      >
        <header class="ms-admin-header">
          <h1>Moderation</h1>
          <div class="ms-admin-header-actions">
            <Show when={status()}>
              <span class="ms-admin-status">{status()}</span>
            </Show>
            <button
              type="button"
              class="ms-btn"
              onClick={() => {
                setStatus('');
                load();
              }}
              disabled={loading()}
            >
              {loading() ? 'Refreshing…' : 'Refresh'}
            </button>
            <button type="button" class="ms-btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <section class="ms-admin-section">
          <div class="ms-admin-section-head">
            <h2>Reports ({reports().length})</h2>
            <button
              type="button"
              class="ms-btn"
              onClick={clearReports}
              disabled={!reports().length}
            >
              Clear
            </button>
          </div>

          <Show
            when={reports().length}
            fallback={<p class="ms-admin-empty">No reports yet.</p>}
          >
            <div class="ms-admin-table-wrap">
              <table class="ms-admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Player</th>
                    <th>Fame</th>
                    <th>IP</th>
                    <th>Reason</th>
                    <th>Recent chat</th>
                    <th>Reporter</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <For each={reports()}>
                    {(report) => (
                      <tr>
                        <td class="ms-admin-nowrap">{formatTime(report.at)}</td>
                        <td>{report.targetName}</td>
                        <td class={`ms-admin-fame ${fameTone(report.targetFame)}`}>
                          {report.targetFame ?? 0}
                        </td>
                        <td class="ms-admin-mono">{report.targetIp || '—'}</td>
                        <td>{report.reason || <em>no reason given</em>}</td>
                        <td class="ms-admin-chat-cell">
                          <Show
                            when={report.recentMessages?.length}
                            fallback={<span class="ms-admin-muted">—</span>}
                          >
                            <ul class="ms-admin-chat">
                              <For each={report.recentMessages}>
                                {(message) => (
                                  <li title={formatTime(message.at)}>{message.text}</li>
                                )}
                              </For>
                            </ul>
                          </Show>
                        </td>
                        <td>
                          {report.reporterName}
                          <span class="ms-admin-mono"> ({report.reporterIp})</span>
                        </td>
                        <td>
                          <Show
                            when={report.targetIp && bannedIps().has(report.targetIp)}
                            fallback={
                              <button
                                type="button"
                                class="ms-btn ms-btn-red"
                                disabled={!report.targetIp}
                                onClick={() => banIp(report.targetIp, report.reason)}
                              >
                                Ban IP
                              </button>
                            }
                          >
                            <button
                              type="button"
                              class="ms-btn"
                              onClick={() => unbanIp(report.targetIp)}
                            >
                              Unban
                            </button>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </section>

        <section class="ms-admin-section">
          <div class="ms-admin-section-head">
            <h2>Banned IPs ({bans().length})</h2>
          </div>

          <form class="ms-admin-ban-form" onSubmit={banFromForm}>
            <input
              class="ms-input"
              placeholder="IP address"
              value={manualIp()}
              onInput={(event) => setManualIp(event.currentTarget.value)}
            />
            <input
              class="ms-input"
              placeholder="Reason (optional)"
              maxLength={200}
              value={manualReason()}
              onInput={(event) => setManualReason(event.currentTarget.value)}
            />
            <button type="submit" class="ms-btn ms-btn-red" disabled={!manualIp().trim()}>
              Ban
            </button>
          </form>

          <Show
            when={bans().length}
            fallback={<p class="ms-admin-empty">No banned IPs.</p>}
          >
            <div class="ms-admin-table-wrap">
              <table class="ms-admin-table">
                <thead>
                  <tr>
                    <th>IP</th>
                    <th>Reason</th>
                    <th>Since</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <For each={bans()}>
                    {(ban) => (
                      <tr>
                        <td class="ms-admin-mono">{ban.ip}</td>
                        <td>{ban.reason || <em>no reason given</em>}</td>
                        <td class="ms-admin-nowrap">{formatTime(ban.at)}</td>
                        <td>
                          <button
                            type="button"
                            class="ms-btn"
                            onClick={() => unbanIp(ban.ip)}
                          >
                            Unban
                          </button>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </section>
      </Show>
    </div>
  );
}
