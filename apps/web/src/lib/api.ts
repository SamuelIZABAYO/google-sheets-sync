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

export type SyncJobStatus = 'active' | 'paused' | 'archived';
export type SyncTriggerType = 'manual' | 'schedule' | 'webhook';
export type SyncLastRunStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';

export type SyncJob = {
  id: number;
  userId: number;
  name: string;
  status: SyncJobStatus;
  sourceSpreadsheetId: string;
  sourceSheetName: string | null;
  destinationType: string;
  destinationConfigJson: string;
  fieldMappingJson: string;
  triggerType: SyncTriggerType;
  triggerConfigJson: string | null;
  cronExpression: string | null;
  queueTopic: string;
  lastRunStatus: SyncLastRunStatus;
  lastRunAt: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSyncJobInput = {
  name: string;
  sourceSpreadsheetId: string;
  sourceSheetName?: string | null;
  destinationType: string;
  destinationConfig: Record<string, unknown>;
  fieldMapping: Record<string, unknown>;
  triggerType?: SyncTriggerType;
  triggerConfig?: Record<string, unknown> | null;
  cronExpression?: string | null;
  queueTopic?: string;
};

export type UpdateSyncJobInput = {
  name?: string;
  status?: SyncJobStatus;
  sourceSpreadsheetId?: string;
  sourceSheetName?: string | null;
  destinationType?: string;
  destinationConfig?: Record<string, unknown>;
  fieldMapping?: Record<string, unknown>;
  triggerType?: SyncTriggerType;
  triggerConfig?: Record<string, unknown> | null;
  cronExpression?: string | null;
  queueTopic?: string;
};

export type SyncRun = {
  id: number;
  jobId: number;
  userId: number;
  triggerType: SyncTriggerType;
  status: SyncLastRunStatus;
  queueMessageId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  recordsProcessed: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
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

  async listSyncJobs(accessToken: string): Promise<SyncJob[]> {
    const response = await this.authedRequest('/sync-jobs', accessToken);
    const body = (await response.json()) as { jobs: SyncJob[] };
    return body.jobs;
  }

  async createSyncJob(accessToken: string, payload: CreateSyncJobInput): Promise<SyncJob> {
    const response = await this.authedRequest('/sync-jobs', accessToken, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const body = (await response.json()) as { job: SyncJob };
    return body.job;
  }

  async updateSyncJob(accessToken: string, id: number, payload: UpdateSyncJobInput): Promise<SyncJob> {
    const response = await this.authedRequest(`/sync-jobs/${id}`, accessToken, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    const body = (await response.json()) as { job: SyncJob };
    return body.job;
  }

  async deleteSyncJob(accessToken: string, id: number): Promise<void> {
    await this.authedRequest(`/sync-jobs/${id}`, accessToken, {
      method: 'DELETE'
    });
  }

  async runSyncJob(accessToken: string, id: number): Promise<SyncRun> {
    const response = await this.authedRequest(`/sync-jobs/${id}/run`, accessToken, {
      method: 'POST'
    });

    const body = (await response.json()) as { run: SyncRun };
    return body.run;
  }

  private async authedRequest(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${accessToken}`);

    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const response = await fetch(buildUrl(this.baseUrl, path), {
      ...init,
      headers
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status);
    }

    return response;
  }
}

export function createApiClientFromEnv(): ApiClient {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
  return new ApiClient(baseUrl);
}
