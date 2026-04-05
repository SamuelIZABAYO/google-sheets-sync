import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { ApiClient, ApiError, createApiClientFromEnv, type PublicUser } from '../lib/api';

type AuthContextValue = {
  user: PublicUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const STORAGE_KEY = 'gssync_access_token';
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredToken(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

function persistToken(token: string | null): void {
  if (token) {
    window.localStorage.setItem(STORAGE_KEY, token);
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}

type AuthProviderProps = PropsWithChildren<{
  apiClient?: ApiClient;
}>;

export function AuthProvider({ children, apiClient = createApiClientFromEnv() }: AuthProviderProps) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [token, setToken] = useState<string | null>(readStoredToken());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function hydrateUser() {
      if (!token) {
        if (active) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const me = await apiClient.me(token);
        if (active) {
          setUser(me.user);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          persistToken(null);
          if (active) {
            setToken(null);
            setUser(null);
          }
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void hydrateUser();

    return () => {
      active = false;
    };
  }, [apiClient, token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      async login(email: string, password: string) {
        const result = await apiClient.login(email, password);
        persistToken(result.accessToken);
        setToken(result.accessToken);
        setUser(result.user);
      },
      logout() {
        persistToken(null);
        setToken(null);
        setUser(null);
      }
    }),
    [apiClient, isLoading, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
