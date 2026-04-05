export type AuthProvider = 'local' | 'google';

export type User = {
  id: number;
  email: string;
  passwordHash: string | null;
  authProvider: AuthProvider;
  googleSub: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicUser = {
  id: number;
  email: string;
  authProvider: AuthProvider;
  createdAt: string;
  updatedAt: string;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    authProvider: user.authProvider,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}
