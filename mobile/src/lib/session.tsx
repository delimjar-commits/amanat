import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { createApi, pingServer, wakeServer, type Api, type ServerStatus } from './api';
import type { AppConfig, Me } from './types';

const TOKEN_KEY = 'amanat_token';
const ADMIN_KEY = 'amanat_admin_token';

// The web build is served by the API server itself (/app), so on the web the API is the
// page's own origin. The Android app uses the hosted server set at build time.
const sameOrigin =
  typeof window !== 'undefined' && typeof window.location !== 'undefined' && /^https?:$/.test(window.location.protocol) && window.location.pathname.startsWith('/app')
    ? window.location.origin
    : '';
export const API_ROOT = (sameOrigin || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

const store = {
  async get(key: string) {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string | null) {
    if (Platform.OS === 'web') {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
      return;
    }
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  },
};

export type AdminInfo = { id: string; email: string; name: string; role: string };

interface Session {
  ready: boolean;
  server: ServerStatus | 'checking';
  serverSince: number;
  retryServer: () => void;
  token: string | null;
  me: Me | null;
  config: AppConfig | null;
  api: Api;
  refreshMe: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, referral?: string) => Promise<void>;
  signOut: () => Promise<void>;
  adminToken: string | null;
  admin: AdminInfo | null;
  adminApi: Api;
  setAdminSession: (token: string, admin: AdminInfo) => Promise<void>;
  adminSignOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

function deviceId() {
  const k = 'amanat_device';
  try {
    if (Platform.OS === 'web') {
      let v = globalThis.localStorage?.getItem(k);
      if (!v) {
        v = `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        globalThis.localStorage?.setItem(k, v);
      }
      return v;
    }
  } catch {}
  return `${Platform.OS}-device`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [server, setServer] = useState<ServerStatus | 'checking'>('checking');
  const [serverSince, setServerSince] = useState(Date.now());
  const [token, setToken] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const tokenRef = useRef<string | null>(null);
  const adminRef = useRef<string | null>(null);

  const onStatus = useCallback((s: ServerStatus) => {
    setServer((prev) => {
      if (s === 'waking' && prev !== 'waking') setServerSince(Date.now());
      return s;
    });
  }, []);

  const clearUser = useCallback(() => {
    tokenRef.current = null;
    setToken(null);
    setMe(null);
    store.set(TOKEN_KEY, null);
  }, []);
  const clearAdmin = useCallback(() => {
    adminRef.current = null;
    setAdminToken(null);
    setAdmin(null);
    store.set(ADMIN_KEY, null);
  }, []);

  const api = useMemo(() => createApi(API_ROOT, () => tokenRef.current, clearUser, onStatus), [clearUser, onStatus]);
  const adminApi = useMemo(() => createApi(API_ROOT, () => adminRef.current, clearAdmin, onStatus), [clearAdmin, onStatus]);

  const refreshMe = useCallback(async () => {
    if (!tokenRef.current) return;
    const r = await api.get<Me>('/api/me');
    setMe(r);
  }, [api]);

  const boot = useCallback(async () => {
    setServer('checking');
    setServerSince(Date.now());
    let up = await pingServer(API_ROOT, 8000);
    if (!up) {
      setServer('waking');
      up = await wakeServer(API_ROOT);
    }
    if (!up) {
      setServer('down');
      return;
    }
    setServer('ok');
    const [t, at] = await Promise.all([store.get(TOKEN_KEY), store.get(ADMIN_KEY)]);
    tokenRef.current = t;
    adminRef.current = at;
    setToken(t);
    setAdminToken(at);
    try {
      setConfig(await api.get<AppConfig>('/api/config'));
    } catch {}
    if (t) {
      try {
        setMe(await api.get<Me>('/api/me'));
      } catch {}
    }
    if (at) {
      try {
        const r = await adminApi.get<{ admin: AdminInfo }>('/api/admin/me');
        setAdmin(r.admin);
      } catch {}
    }
    setReady(true);
  }, [api, adminApi]);

  useEffect(() => {
    boot();
  }, [boot]);

  const afterAuth = useCallback(
    async (r: { token: string }) => {
      tokenRef.current = r.token;
      setToken(r.token);
      await store.set(TOKEN_KEY, r.token);
      setMe(await api.get<Me>('/api/me'));
    },
    [api],
  );

  const value: Session = {
    ready,
    server,
    serverSince,
    retryServer: boot,
    token,
    me,
    config,
    api,
    refreshMe,
    signIn: async (email, password) => afterAuth(await api.post('/api/auth/login', { email, password, device: deviceId() })),
    register: async (name, email, password, referral) =>
      afterAuth(await api.post('/api/auth/register', { name, email, password, referral: referral || undefined, device: deviceId(), locale: 'en' })),
    signOut: async () => clearUser(),
    adminToken,
    admin,
    adminApi,
    setAdminSession: async (t, a) => {
      adminRef.current = t;
      setAdminToken(t);
      setAdmin(a);
      await store.set(ADMIN_KEY, t);
    },
    adminSignOut: async () => clearAdmin(),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
