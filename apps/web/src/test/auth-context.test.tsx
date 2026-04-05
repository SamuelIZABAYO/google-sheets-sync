import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../context/auth-context';
import { ApiClient, ApiError, type MeResponse, type LoginResponse } from '../lib/api';

function Probe() {
  const { user, isLoading } = useAuth();
  return (
    <div>
      <p data-testid="loading">{String(isLoading)}</p>
      <p data-testid="email">{user?.email ?? 'none'}</p>
    </div>
  );
}

class StubApiClient extends ApiClient {
  constructor(
    private readonly impl: {
      me: (token: string) => Promise<MeResponse>;
      login: (email: string, password: string) => Promise<LoginResponse>;
    }
  ) {
    super('');
  }

  override login(email: string, password: string): Promise<LoginResponse> {
    return this.impl.login(email, password);
  }

  override me(token: string): Promise<MeResponse> {
    return this.impl.me(token);
  }
}

describe('AuthProvider', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('hydrates user from stored token', async () => {
    window.localStorage.setItem('gssync_access_token', 'token-1');

    const api = new StubApiClient({
      login: vi.fn(async () => ({ user: { id: 1, email: 'a@b.com', createdAt: '', updatedAt: '' }, accessToken: 'x' })),
      me: vi.fn(async () => ({ user: { id: 1, email: 'owner@example.com', createdAt: '', updatedAt: '' } }))
    });

    render(
      <AuthProvider apiClient={api}>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('email').textContent).toContain('owner@example.com');
      expect(screen.getByTestId('loading').textContent).toContain('false');
    });
  });

  it('clears token when me responds 401', async () => {
    window.localStorage.setItem('gssync_access_token', 'bad-token');

    const api = new StubApiClient({
      login: vi.fn(async () => ({ user: { id: 1, email: 'a@b.com', createdAt: '', updatedAt: '' }, accessToken: 'x' })),
      me: vi.fn(async () => {
        throw new ApiError('Invalid token', 401);
      })
    });

    render(
      <AuthProvider apiClient={api}>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('email').textContent).toContain('none');
      expect(window.localStorage.getItem('gssync_access_token')).toBeNull();
      expect(screen.getByTestId('loading').textContent).toContain('false');
    });
  });
});
