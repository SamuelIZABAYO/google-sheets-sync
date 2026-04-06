import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CircleAlert, Loader2, LogOut, Play, Plus, Save, Trash2 } from 'lucide-react';
import { ApiError, createApiClientFromEnv, type SyncJob, type SyncJobStatus, type SyncTriggerType } from '../lib/api';
import { useAuth } from '../context/auth-context';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';

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
    return 'Never';
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

function statusVariant(status: SyncJobStatus) {
  if (status === 'active') {
    return 'default';
  }
  if (status === 'paused') {
    return 'secondary';
  }
  return 'outline';
}

function runVariant(status: SyncJob['lastRunStatus']) {
  if (status === 'failed') {
    return 'destructive';
  }
  if (status === 'succeeded') {
    return 'default';
  }
  return 'secondary';
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

  const activeCount = jobs.filter((job) => job.status === 'active').length;
  const failedCount = jobs.filter((job) => job.lastRunStatus === 'failed').length;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="container flex flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Sync Job Management</h1>
            <p className="text-sm text-muted-foreground">Signed in as {user?.email}</p>
          </div>
          <Button variant="outline" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" /> Log out
          </Button>
        </div>
      </header>

      <main className="container py-6">
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Jobs</CardDescription>
              <CardTitle className="text-3xl">{jobs.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active Pipelines</CardDescription>
              <CardTitle className="text-3xl">{activeCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failed Last Runs</CardDescription>
              <CardTitle className="text-3xl">{failedCount}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {error ? (
          <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <CircleAlert className="h-4 w-4" />
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>{mode === 'create' ? 'Create sync job' : `Edit job #${editingJobId ?? ''}`}</CardTitle>
                  <CardDescription>Configure source, destination, and trigger settings.</CardDescription>
                </div>
                {mode === 'edit' ? (
                  <Button variant="outline" size="sm" onClick={startCreate}>
                    <Plus className="mr-2 h-4 w-4" /> New
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="job-name">Name</Label>
                  <Input id="job-name" value={formState.name} onChange={(event) => updateField('name', event.currentTarget.value)} required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="source-id">Source Spreadsheet ID</Label>
                  <Input id="source-id" value={formState.sourceSpreadsheetId} onChange={(event) => updateField('sourceSpreadsheetId', event.currentTarget.value)} required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sheet-name">Source Sheet Name (optional)</Label>
                  <Input id="sheet-name" value={formState.sourceSheetName} onChange={(event) => updateField('sourceSheetName', event.currentTarget.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="destination-type">Destination Type</Label>
                  <Input id="destination-type" value={formState.destinationType} onChange={(event) => updateField('destinationType', event.currentTarget.value)} required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="destination-config">Destination Config (JSON)</Label>
                  <Textarea id="destination-config" value={formState.destinationConfigJson} onChange={(event) => updateField('destinationConfigJson', event.currentTarget.value)} rows={4} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="field-mapping">Field Mapping (JSON)</Label>
                  <Textarea id="field-mapping" value={formState.fieldMappingJson} onChange={(event) => updateField('fieldMappingJson', event.currentTarget.value)} rows={4} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Trigger Type</Label>
                    <Select value={formState.triggerType} onValueChange={(value) => updateField('triggerType', value as SyncTriggerType)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose trigger" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">manual</SelectItem>
                        <SelectItem value="schedule">schedule</SelectItem>
                        <SelectItem value="webhook">webhook</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={formState.status} onValueChange={(value) => updateField('status', value as SyncJobStatus)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="paused">paused</SelectItem>
                        <SelectItem value="archived">archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trigger-config">Trigger Config (JSON)</Label>
                  <Textarea id="trigger-config" value={formState.triggerConfigJson} onChange={(event) => updateField('triggerConfigJson', event.currentTarget.value)} rows={3} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="cron">Cron Expression (optional)</Label>
                    <Input id="cron" value={formState.cronExpression} onChange={(event) => updateField('cronExpression', event.currentTarget.value)} placeholder="*/10 * * * *" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="queue-topic">Queue Topic</Label>
                    <Input id="queue-topic" value={formState.queueTopic} onChange={(event) => updateField('queueTopic', event.currentTarget.value)} />
                  </div>
                </div>

                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" /> {mode === 'create' ? 'Create job' : 'Save changes'}
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Jobs & run status</CardTitle>
              <CardDescription>Review run health and trigger actions instantly.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs...
                </div>
              ) : null}

              {!isLoading && jobs.length === 0 ? <p className="text-sm text-muted-foreground">No sync jobs yet. Create your first one.</p> : null}

              {!isLoading && jobs.length > 0 ? (
                <div className="space-y-3">
                  {jobs.map((job) => (
                    <div key={job.id} className="rounded-lg border bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{job.name}</h3>
                          <p className="text-xs text-muted-foreground">{job.sourceSpreadsheetId}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                          <Badge variant={runVariant(job.lastRunStatus)}>{job.lastRunStatus}</Badge>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                        <p className="flex items-center gap-2">
                          <CalendarClock className="h-4 w-4" /> Last run: {formatTimestamp(job.lastRunAt)}
                        </p>
                        <p>Trigger: {job.triggerType}</p>
                        {job.lastErrorMessage ? <p className="text-destructive sm:col-span-2">Error: {job.lastErrorMessage}</p> : null}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={() => startEdit(job)}>
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => onRun(job)} disabled={activeJobId === job.id}>
                          {activeJobId === job.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                          Run now
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => onDelete(job)} disabled={activeJobId === job.id}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
