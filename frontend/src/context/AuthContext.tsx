"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api, setToken, removeToken } from "@/lib/api";
import { useRouter } from "next/navigation";

interface User {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface LoginResponse {
  token: string;
  user: User;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // On mount — check if we have a valid token and load user
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ user: User }>("/api/auth/me");
      setUser(data.user);
      setError(null);
    } catch {
      setUser(null);
      removeToken();
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResponse> => {
      setError(null);
      setLoading(true);

      try {
        const data = await api.post<LoginResponse>("/api/auth/login", {
          username,
          password,
        });

        setToken(data.token);
        setUser(data.user);
        return data;
      } catch (err: any) {
        setError(err?.body?.error || err.message || "Login failed");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // ignore errors — we clear local state anyway
    }
    removeToken();
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
