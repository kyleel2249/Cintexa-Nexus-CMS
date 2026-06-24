import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: "admin" | "editor" | string;
  avatar: string | null;
  status: string;
  lastLoginAt: string | null;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "cintexa_token";

function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function storeToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, token: getStoredToken(), isLoading: true });

  const apiFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = getStoredToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
    return res;
  }, []);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) { setState({ user: null, token: null, isLoading: false }); return; }
    try {
      const res = await apiFetch("/api/auth/me");
      if (res.ok) {
        const { user } = await res.json();
        setState({ user, token, isLoading: false });
      } else {
        storeToken(null);
        setState({ user: null, token: null, isLoading: false });
      }
    } catch {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [apiFetch]);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Login failed");
    storeToken(data.token);
    setState({ user: data.user, token: data.token, isLoading: false });
  }, [apiFetch]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await apiFetch("/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Registration failed");
    storeToken(data.token);
    setState({ user: data.user, token: data.token, isLoading: false });
  }, [apiFetch]);

  const logout = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    storeToken(null);
    setState({ user: null, token: null, isLoading: false });
  }, [apiFetch]);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
