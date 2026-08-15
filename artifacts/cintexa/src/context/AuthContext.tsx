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
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const TOKEN_KEY = "cintexa_token";

function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function storeToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

async function readApiResponse(res: Response, fallback: string) {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`${fallback} (server returned an empty response, HTTP ${res.status})`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${fallback} (server returned ${res.status} ${res.statusText || "a non-JSON response"})`);
  }

  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(`${fallback} (server returned invalid JSON, HTTP ${res.status})`);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, token: getStoredToken(), isLoading: true });

  const apiFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = getStoredToken();
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(path, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  }, []);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) { setState({ user: null, token: null, isLoading: false }); return; }
    try {
      const res = await apiFetch("/api/auth/me");
      if (res.ok) {
        const data = await readApiResponse(res, "Unable to restore your session");
        setState({ user: data.user, token, isLoading: false });
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
    let res: Response;
    try {
      res = await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    } catch {
      throw new Error("Unable to connect to the authentication server. Start the API with npm run dev:api or npm run dev:all.");
    }
    const data = await readApiResponse(res, "Login failed");
    if (!res.ok) throw new Error(data.error ?? `Login failed (HTTP ${res.status})`);
    if (!data.token || !data.user) throw new Error("Login failed: the authentication server returned an incomplete response.");
    storeToken(data.token);
    setState({ user: data.user, token: data.token, isLoading: false });
  }, [apiFetch]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    let res: Response;
    try {
      res = await apiFetch("/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) });
    } catch {
      throw new Error("Unable to connect to the authentication server. Start the API with npm run dev:api or npm run dev:all.");
    }
    const data = await readApiResponse(res, "Registration failed");
    if (!res.ok) throw new Error(data.error ?? `Registration failed (HTTP ${res.status})`);
    if (!data.token || !data.user) throw new Error("Registration failed: the authentication server returned an incomplete response.");
    storeToken(data.token);
    setState({ user: data.user, token: data.token, isLoading: false });
  }, [apiFetch]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    let res: Response;
    try {
      res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    } catch {
      throw new Error("Unable to connect to the authentication server. Start the API with npm run dev:api or npm run dev:all.");
    }
    const data = await readApiResponse(res, "Password change failed");
    if (!res.ok) throw new Error(data.error ?? `Password change failed (HTTP ${res.status})`);
  }, [apiFetch]);

  const logout = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    storeToken(null);
    setState({ user: null, token: null, isLoading: false });
  }, [apiFetch]);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refreshUser, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
