import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError, createApiClientFromEnv, type SyncJob, type SyncJobStatus, type SyncTriggerType } from '../lib/api';
import { useAuth } from '../context/auth-context';

type JobFormState = {
  name: string;
  sourceSpreadsheetId: string;
  sourceSheetName: string;
  destinationType: string;
  destinationConfigJson: string;
  fieldMappingJson: string;
  triggerType: SyncTriggerType;
  triggerConfigJson: string;
  cronExpression: string;
  queueTopic: string;
  status: SyncJobStatus;
};

const defaultFormState: JobFormState = {
  name: '',
  sourceSpreadsheetId: '',
  sourceSheetName: '',
  destinationType: 'sqlite',
  destinationConfigJson: '{\n  "table": "sync_data"\n}',
  fieldMappingJson: '{\n  "source_field": "destination_column"\n}',
  triggerType: 'manual',
  triggerConfigJson: '{}',
  cronExpression: '',
  queueTopic: 'sync-jobs',
  status: 'active'
};

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function parseJsonObject(value: string, fieldName: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

function mapJobToFormState(job: SyncJob): JobFormState {
  return {
    name: job.name,
    sourceSpreadsheetId: job.sourceSpreadsheetId,
    sourceSheetName: job.sourceSheetName ?? '',
    destinationType: job.destinationType,
    destinationConfigJson: job.destinationConfigJson,
    fieldMappingJson: job.fieldMappingJson,
    triggerType: job.triggerType,
    triggerConfigJson: job.triggerConfigJson ?? '{}',
    cronExpression: job.cronExpression ?? '',
    queueTopic: job.queueTopic,
    status: job.status
  };
}

export function DashboardPage() {
  const { user, token, logout } = useAuth();
  const apiClient = useMemo(() => createApiClientFromEnv(), []);

  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [editingJobId, setEditingJobId] = useState<number | null>(null);
  const [formState, setFormState] = useState<JobFormState>(defaultFormState);
  const [submitting, setSubmitting] = useState(false);

  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    async function loadJobs() {
      setIsLoading(true);
      setError(null);

      try {
        const result = await apiClient.listSyncJobs(token);
        if (active) {
          setJobs(result);
        }
      } catch (loadError) {
        if (!active) {
          return;
        }

        if (loadError instanceof ApiError) {
          setError(loadError.message);
          if (loadError.status === 401) {
            logout();
          }
        } else {
          setError('Failed to load sync jobs');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadJobs();

    return () => {
      active = false;
    };
  }, [apiClient, logout, token]);

  function startCreate() {
    setMode('create');
    setEditingJobId(null);
    setFormState(defaultFormState);
    setError(null);
  }

  function startEdit(job: SyncJob) {
    setMode('edit');
    setEditingJobId(job.id);
    setFormState(mapJobToFormState(job));
    setError(null);
  }

  function updateField<K extends keyof JobFormState>(key: K, value: JobFormState[K]) {
    setFormState((previous) => ({ ...previous, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const destinationConfig = parseJsonObject(formState.destinationConfigJson, 'Destination config');
      const fieldMapping = parseJsonObject(formState.fieldMappingJson, 'Field mapping');
      const triggerConfig = parseJsonObject(formState.triggerConfigJson, 'Trigger config');

      if (mode === 'create') {
        const created = await apiClient.createSyncJob(token, {
          name: formState.name.trim(),
          sourceSpreadsheetId: formState.sourceSpreadsheetId.trim(),
          sourceSheetName: formState.sourceSheetName.trim() || null,
          destinationType: formState.destinationType.trim(),
          destinationConfig,
          fieldMapping,
          triggerType: formState.triggerType,
          triggerConfig,
          cronExpression: formState.cronExpression.trim() || null,
          queueTopic: formState.queueTopic.trim() || undefined
        });

        setJobs((previous) => [created, ...previous]);
        startCreate();
      } else if (editingJobId) {
        const updated = await apiClient.updateSyncJob(token, editingJobId, {
          name: formState.name.trim(),
          status: formState.status,
          sourceSpreadsheetId: formState.sourceSpreadsheetId.trim(),
          sourceSheetName: formState.sourceSheetName.trim() || null,
          destinationType: formState.destinationType.trim(),
          destinationConfig,
          fieldMapping,
          triggerType: formState.triggerType,
          triggerConfig,
          cronExpression: formState.cronExpression.trim() || null,
          queueTopic: formState.queueTopic.trim() || undefined
        });

        setJobs((previous) => previous.map((job) => (job.id === updated.id ? updated : job)));
      }
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        setError(submitError.message);
        if (submitError.status === 401) {
          logout();
        }
      } else if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError('Failed to save sync job');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(job: SyncJob) {
    if (!token) {
      return;
    }

    const confirmed = window.confirm(`Delete sync job "${job.name}"?`);
    if (!confirmed) {
      return;
    }

    setActiveJobId(job.id);
    setError(null);

    try {
      await apiClient.deleteSyncJob(token, job.id);
      setJobs((previous) => previous.filter((item) => item.id !== job.id));

      if (editingJobId === job.id) {
        startCreate();
      }
    } catch (deleteError) {
      if (deleteError instanceof ApiError) {
        setError(deleteError.message);
        if (deleteError.status === 401) {
          logout();
        }
      } else {
        setError('Failed to delete sync job');
      }
    } finally {
      setActiveJobId(null);
    }
  }

  async function onRun(job: SyncJob) {
    if (!token) {
      return;
    }

    setActiveJobId(job.id);
    setError(null);

    try {
      const run = await apiClient.runSyncJob(token, job.id);
      setJobs((previous) =>
        previous.map((item) =>
          item.id === job.id
            ? {
                ...item,
                lastRunStatus: run.status,
                lastRunAt: run.createdAt,
                lastErrorMessage: run.errorMessage
              }
            : item
        )
      );
    } catch (runError) {
      if (runError instanceof ApiError) {
        setError(runError.message);
        if (runError.status === 401) {
          logout();
        }
      } else {
        setError('Failed to trigger sync run');
      }
    } finally {
      setActiveJobId(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>Sync Job Management</h1>
          <p style={{ margin: '0.25rem 0 0', color: '#64748b' }}>{user?.email}</p>
        </div>
        <button type="button" onClick={logout} style={{ padding: '0.5rem 0.75rem' }}>
          Log out
        </button>
      </header>

      <main style={{ display: 'grid', gridTemplateColumns: 'minmax(330px, 420px) 1fr', gap: '1rem', padding: '1rem 1.5rem' }}>
        <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ marginTop: 0 }}>{mode === 'create' ? 'Create sync job' : `Edit job #${editingJobId ?? ''}`}</h2>
            {mode === 'edit' ? (
              <button type="button" onClick={startCreate} style={{ padding: '0.4rem 0.6rem' }}>
                New job
              </button>
            ) : null}
          </div>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.6rem' }}>
            <label>
              Name
              <input value={formState.name} onChange={(event) => updateField('name', event.currentTarget.value)} required style={{ width: '100%', padding: '0.45rem' }} />
            </label>
            <label>
              Source Spreadsheet ID
              <input
                value={formState.sourceSpreadsheetId}
                onChange={(event) => updateField('sourceSpreadsheetId', event.currentTarget.value)}
                required
                style={{ width: '100%', padding: '0.45rem' }}
              />
            </label>
            <label>
              Source Sheet Name (optional)
              <input value={formState.sourceSheetName} onChange={(event) => updateField('sourceSheetName', event.currentTarget.value)} style={{ width: '100%', padding: '0.45rem' }} />
            </label>
            <label>
              Destination Type
              <input value={formState.destinationType} onChange={(event) => updateField('destinationType', event.currentTarget.value)} required style={{ width: '100%', padding: '0.45rem' }} />
            </label>
            <label>
              Destination Config (JSON)
              <textarea value={formState.destinationConfigJson} onChange={(event) => updateField('destinationConfigJson', event.currentTarget.value)} rows={4} style={{ width: '100%' }} />
            </label>
            <label>
              Field Mapping (JSON)
              <textarea value={formState.fieldMappingJson} onChange={(event) => updateField('fieldMappingJson', event.currentTarget.value)} rows={4} style={{ width: '100%' }} />
            </label>
            <label>
              Trigger Type
              <select value={formState.triggerType} onChange={(event) => updateField('triggerType', event.currentTarget.value as SyncTriggerType)} style={{ width: '100%', padding: '0.45rem' }}>
                <option value="manual">manual</option>
                <option value="schedule">schedule</option>
                <option value="webhook">webhook</option>
              </select>
            </label>
            <label>
              Trigger Config (JSON)
              <textarea value={formState.triggerConfigJson} onChange={(event) => updateField('triggerConfigJson', event.currentTarget.value)} rows={3} style={{ width: '100%' }} />
            </label>
            <label>
              Cron Expression (optional)
              <input value={formState.cronExpression} onChange={(event) => updateField('cronExpression', event.currentTarget.value)} placeholder="*/10 * * * *" style={{ width: '100%', padding: '0.45rem' }} />
            </label>
            <label>
              Queue Topic
              <input value={formState.queueTopic} onChange={(event) => updateField('queueTopic', event.currentTarget.value)} style={{ width: '100%', padding: '0.45rem' }} />
            </label>
            <label>
              Status
              <select value={formState.status} onChange={(event) => updateField('status', event.currentTarget.value as SyncJobStatus)} style={{ width: '100%', padding: '0.45rem' }}>
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="archived">archived</option>
              </select>
            </label>

            <button type="submit" disabled={submitting} style={{ padding: '0.6rem 0.8rem' }}>
              {submitting ? 'Saving…' : mode === 'create' ? 'Create job' : 'Save changes'}
            </button>
          </form>
        </section>

        <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Jobs & run status</h2>
          {error ? <p role="alert" style={{ color: '#b00020' }}>{error}</p> : null}

          {isLoading ? <p>Loading jobs…</p> : null}

          {!isLoading && jobs.length === 0 ? <p>No sync jobs yet. Create your first one.</p> : null}

          {!isLoading && jobs.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', padding: '0.4rem' }}>Name</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', padding: '0.4rem' }}>Status</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', padding: '0.4rem' }}>Trigger</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', padding: '0.4rem' }}>Last run</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', padding: '0.4rem' }}>Run status</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', padding: '0.4rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td style={{ borderBottom: '1px solid #f1f5f9', padding: '0.45rem' }}>
                        <strong>{job.name}</strong>
                        <div style={{ color: '#64748b', fontSize: '0.85rem' }}>{job.sourceSpreadsheetId}</div>
                      </td>
                      <td style={{ borderBottom: '1px solid #f1f5f9', padding: '0.45rem' }}>{job.status}</td>
                      <td style={{ borderBottom: '1px solid #f1f5f9', padding: '0.45rem' }}>{job.triggerType}</td>
                      <td style={{ borderBottom: '1px solid #f1f5f9', padding: '0.45rem' }}>{formatTimestamp(job.lastRunAt)}</td>
                      <td style={{ borderBottom: '1px solid #f1f5f9', padding: '0.45rem' }}>
                        <div>{job.lastRunStatus}</div>
                        {job.lastErrorMessage ? <div style={{ color: '#b00020', fontSize: '0.8rem' }}>{job.lastErrorMessage}</div> : null}
                      </td>
                      <td style={{ borderBottom: '1px solid #f1f5f9', padding: '0.45rem', whiteSpace: 'nowrap' }}>
                        <button type="button" onClick={() => startEdit(job)} style={{ marginRight: '0.3rem' }}>
                          Edit
                        </button>
                        <button type="button" onClick={() => onRun(job)} disabled={activeJobId === job.id} style={{ marginRight: '0.3rem' }}>
                          {activeJobId === job.id ? 'Running…' : 'Run now'}
                        </button>
                        <button type="button" onClick={() => onDelete(job)} disabled={activeJobId === job.id}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
