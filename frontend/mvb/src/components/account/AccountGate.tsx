import { useState } from "react";
import { useAccountSession } from "../../hooks/useAccountSession";
import type { ReactNode } from "react";
import "./AccountGate.css";

export default function AccountGate({ apiUrl, children }: { apiUrl: string; children: ReactNode }) {
  const { user, loading, error, setError, login, logout } = useAccountSession(apiUrl);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("premium@nova.demo");
  const [password, setPassword] = useState("NovaDemo123!");
  if (loading)
    return (
      <main className="account-login" role="status">
        Loading your account…
      </main>
    );
  if (!user)
    return (
      <main className="account-login">
        <section>
          <h1>Welcome to Nova</h1>
          <p>Sign in with the same demo account you use on NOVA TV.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              void login(email, password)
                .catch((error) => setError(error.message || "Could not sign in"))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Demo account
              <select
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              >
                <option value="premium@nova.demo">Premium · אורח</option>
                <option value="family@nova.demo">Family · משפחת כהן</option>
                <option value="basic@nova.demo">Basic · דנה לוי</option>
              </select>
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
            <small>Demo password: NovaDemo123!</small>
            <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
          {error && <p role="alert">{error}</p>}
          <small>Mock accounts and subscriptions; no real payments.</small>
        </section>
      </main>
    );
  return (
    <div key={user.id}>
      <div className="account-bar">
        <span dir="auto">
          {user.profile.displayName} · {user.subscription.planName}
        </span>
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void logout()
              .catch((error) => setError(error.message))
              .finally(() => setBusy(false));
          }}
        >
          Sign out / switch account
        </button>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}
