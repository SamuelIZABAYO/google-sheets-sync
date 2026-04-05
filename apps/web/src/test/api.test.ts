import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../lib/api';

describe('ApiClient', () => {
  it('returns login payload on success', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ user: { id: 1, email: 'x@y.com', createdAt: '', updatedAt: '' }, accessToken: 'jwt' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = new ApiClient('http://localhost:3001');
    const result = await client.login('x@y.com', 'Password123!');

    expect(result.accessToken).toBe('jwt');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws ApiError for unauthorized me request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { 'content-type': 'application/json' } }))
    );

    const client = new ApiClient('');

    await expect(client.me('bad-token')).rejects.toBeInstanceOf(ApiError);
  });
});
