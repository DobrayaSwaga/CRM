import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

export interface User {
  id: number;
  login: string;
  name: string;
  roleId: number;
  roleName: string;
  permissions: string[];
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPerm: (perm: string) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { user } = await api.get('/api/auth/me');
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const login = async (loginStr: string, password: string) => {
    await api.post('/api/auth/login', { login: loginStr, password });
    await refresh();
  };

  const logout = async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  };

  const hasPerm = (perm: string) =>
    !!user && (user.permissions.includes('*') || user.permissions.includes(perm));

  return <Ctx.Provider value={{ user, loading, login, logout, hasPerm, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
