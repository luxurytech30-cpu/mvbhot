import { useEffect, useRef, useState } from "react";

type Account = {
  id: string;
  profile: { displayName: string; email: string };
  subscription: { planName: string };
};
export function useAccountSession(apiUrl: string) {
  const [user, setUser] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  async function request(path: string, body?: unknown) {
    const response = await fetch(new URL(path, apiUrl), {
      signal: AbortSignal.timeout(12000),
      credentials: "include",
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
    return data;
  }
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const current = ++generation.current;
      try {
        const session = await request("/api/auth/session");
        if (!disposed && current === generation.current) {
          setUser(session.user);
          setError("");
        }
      } catch (error) {
        if (!disposed && current === generation.current) {
          setUser(null);
          setError(
            (error as { status?: number }).status === 401
              ? ""
              : "Could not reach the account server. Start the backend and try again.",
          );
        }
      } finally {
        if (!disposed && current === generation.current) setLoading(false);
      }
    };
    const channel = new BroadcastChannel("nova-auth");
    channel.onmessage = () => {
      setUser(null);
      void refresh();
    };
    window.addEventListener("focus", refresh);
    void refresh();
    return () => {
      disposed = true;
      channel.close();
      window.removeEventListener("focus", refresh);
    };
    // API URL is the sole connection setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);
  const announce = () => {
    const channel = new BroadcastChannel("nova-auth");
    channel.postMessage("changed");
    channel.close();
  };
  const login = async (email: string, password: string) => {
    const data = await request("/api/auth/login", { email, password });
    generation.current++;
    setUser(data.user);
    announce();
  };
  const logout = async () => {
    await request("/api/auth/logout", {});
    generation.current++;
    setUser(null);
    announce();
  };
  return { user, loading, error, setError, login, logout };
}
