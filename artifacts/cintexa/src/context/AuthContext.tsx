import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { firebaseAuth, firestore } from "@/lib/firebase";

export interface AuthUser {
  id: string;
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

function firebaseError(error: unknown, fallback: string) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code) : "";
  const messages: Record<string, string> = {
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/weak-password": "Choose a stronger password.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "auth/network-request-failed": "Unable to reach Firebase. Check your internet connection.",
    "auth/requires-recent-login": "For security, sign in again before changing your password.",
  };
  return new Error(messages[code] ?? fallback);
}

async function toAuthUser(firebaseUser: FirebaseUser): Promise<AuthUser> {
  const userRef = doc(firestore, "users", firebaseUser.uid);
  const snapshot = await getDoc(userRef);
  const profile = snapshot.exists() ? snapshot.data() : {};

  return {
    id: firebaseUser.uid,
    name: String(profile.name ?? firebaseUser.displayName ?? firebaseUser.email?.split("@")[0] ?? "User"),
    email: firebaseUser.email ?? "",
    role: String(profile.role ?? "editor"),
    avatar: firebaseUser.photoURL ?? (profile.avatar ? String(profile.avatar) : null),
    status: String(profile.status ?? ((firebaseUser as { disabled?: boolean }).disabled ? "disabled" : "active")),
    lastLoginAt: profile.lastLoginAt?.toDate?.()?.toISOString?.() ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, token: null, isLoading: true });

  const refreshUser = useCallback(async () => {
    const firebaseUser = firebaseAuth.currentUser;
    if (!firebaseUser) {
      setState({ user: null, token: null, isLoading: false });
      return;
    }
    try {
      const token = await firebaseUser.getIdToken();
      const user = await toAuthUser(firebaseUser);
      setState({ user, token, isLoading: false });
    } catch {
      setState({ user: null, token: null, isLoading: false });
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (!firebaseUser) {
        setState({ user: null, token: null, isLoading: false });
        return;
      }
      try {
        const token = await firebaseUser.getIdToken();
        const user = await toAuthUser(firebaseUser);
        await setDoc(doc(firestore, "users", firebaseUser.uid), { lastLoginAt: serverTimestamp() }, { merge: true });
        setState({ user, token, isLoading: false });
      } catch {
        setState({ user: null, token: null, isLoading: false });
      }
    });
    return unsubscribe;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
    } catch (error) {
      throw firebaseError(error, "Login failed. Please check your credentials and try again.");
    }
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    try {
      const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
      await updateProfile(credential.user, { displayName: name.trim() });
      await setDoc(doc(firestore, "users", credential.user.uid), {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: "editor",
        status: "active",
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      throw firebaseError(error, "Registration failed. Please try again.");
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const user = firebaseAuth.currentUser;
    if (!user || !user.email) throw new Error("You must be signed in to change your password.");
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
    } catch (error) {
      throw firebaseError(error, "Password change failed. Please verify your current password.");
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(firebaseAuth);
  }, []);

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
