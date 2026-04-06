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

  it('does not send content-type for requests without a body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ run: { id: 1 } }), {
        status: 202,
        headers: { 'content-type': 'application/json' }
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = new ApiClient('');
    await client.runSyncJob('jwt', 1);

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const init = firstCall?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBeNull();
    expect(headers.get('authorization')).toBe('Bearer jwt');
  });

  it('sends content-type for requests with a body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ job: { id: 1 } }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = new ApiClient('');
    await client.createSyncJob('jwt', {
      name: 'Job',
      sourceSpreadsheetId: 'sheet-1',
      destinationType: 'sqlite',
      destinationConfig: { table: 'sync_data' },
      fieldMapping: { id: 'id' }
    });

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const init = firstCall?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
  });
});
