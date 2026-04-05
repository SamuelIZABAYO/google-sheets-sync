export type PublicUser = {
  id: number;
  email: string;
  createdAt: string;
  updatedAt: string;
};

export type LoginResponse = {
  user: PublicUser;
  accessToken: string;
};

export type MeResponse = {
  user: PublicUser;
};

function buildUrl(baseUrl: string, path: string): string {
  if (!baseUrl) {
    return path;
  }

  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await fetch(buildUrl(this.baseUrl, '/auth/login'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(body?.error ?? 'Login failed', response.status);
    }

    return (await response.json()) as LoginResponse;
  }

  async me(accessToken: string): Promise<MeResponse> {
    const response = await fetch(buildUrl(this.baseUrl, '/auth/me'), {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(body?.error ?? 'Unauthorized', response.status);
    }

    return (await response.json()) as MeResponse;
  }
}

export function createApiClientFromEnv(): ApiClient {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
  return new ApiClient(baseUrl);
}
