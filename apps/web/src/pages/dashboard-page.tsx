import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CircleAlert,
  Copy,
  Loader2,
  LogOut,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  WandSparkles
} from 'lucide-react';
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

type JobFilter = 'all' | SyncJobStatus;

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
  const [formError, setFormError] = useState<string | null>(null);

  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [editingJobId, setEditingJobId] = useState<number | null>(null);
  const [formState, setFormState] = useState<JobFormState>(defaultFormState);
  const [submitting, setSubmitting] = useState(false);

  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobFilter>('all');

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
    setFormError(null);
  }

  function startEdit(job: SyncJob) {
    setMode('edit');
    setEditingJobId(job.id);
    setFormState(mapJobToFormState(job));
    setFormError(null);
  }

  function cloneIntoForm(job: SyncJob) {
    setMode('create');
    setEditingJobId(null);
    setFormState({
      ...mapJobToFormState(job),
      name: `${job.name} Copy`
    });
    setFormError(null);
  }

  function updateField<K extends keyof JobFormState>(key: K, value: JobFormState[K]) {
    setFormState((previous) => ({ ...previous, [key]: value }));
  }

  function prettyJsonField(field: 'destinationConfigJson' | 'fieldMappingJson' | 'triggerConfigJson') {
    try {
      const parsed = JSON.parse(formState[field]) as unknown;
      updateField(field, `${JSON.stringify(parsed, null, 2)}\n`);
      setFormError(null);
    } catch {
      setFormError(`Cannot format ${field}: invalid JSON`);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setFormError(null);

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
        setFormError(submitError.message);
        if (submitError.status === 401) {
          logout();
        }
      } else if (submitError instanceof Error) {
        setFormError(submitError.message);
      } else {
        setFormError('Failed to save sync job');
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

  async function onQuickStatusChange(job: SyncJob, nextStatus: SyncJobStatus) {
    if (!token || nextStatus === job.status) {
      return;
    }

    setActiveJobId(job.id);
    setError(null);

    try {
      const updated = await apiClient.updateSyncJob(token, job.id, { status: nextStatus });
      setJobs((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
      if (editingJobId === job.id) {
        updateField('status', updated.status);
      }
    } catch (statusError) {
      if (statusError instanceof ApiError) {
        setError(statusError.message);
        if (statusError.status === 401) {
          logout();
        }
      } else {
        setError('Failed to update status');
      }
    } finally {
      setActiveJobId(null);
    }
  }

  const activeCount = jobs.filter((job) => job.status === 'active').length;
  const failedCount = jobs.filter((job) => job.lastRunStatus === 'failed').length;

  const filteredJobs = jobs
    .filter((job) => (statusFilter === 'all' ? true : job.status === statusFilter))
    .filter((job) => {
      const term = query.trim().toLowerCase();
      if (!term) {
        return true;
      }

      return [job.name, job.sourceSpreadsheetId, job.sourceSheetName ?? '', job.destinationType].some((value) =>
        value.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      return bTime - aTime;
    });

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

      <main className="container space-y-6 py-6">
        <div className="grid gap-4 md:grid-cols-3">
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
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 h-4 w-4" />
            <p>{error}</p>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>{mode === 'create' ? 'Create Sync Job' : 'Edit Sync Job'}</CardTitle>
              <CardDescription>
                Configure source, mapping, destination, and trigger behavior for your pipeline.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {formError ? (
                <p role="alert" className="mb-4 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {formError}
                </p>
              ) : null}

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formState.name}
                    onChange={(event) => updateField('name', event.currentTarget.value)}
                    placeholder="Weekly inventory sync"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sheet-id">Source Spreadsheet ID</Label>
                  <Input
                    id="sheet-id"
                    value={formState.sourceSpreadsheetId}
                    onChange={(event) => updateField('sourceSpreadsheetId', event.currentTarget.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sheet-name">Source Sheet Name (optional)</Label>
                  <Input
                    id="sheet-name"
                    value={formState.sourceSheetName}
                    onChange={(event) => updateField('sourceSheetName', event.currentTarget.value)}
                    placeholder="Sheet1"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="destination-type">Destination Type</Label>
                  <Input
                    id="destination-type"
                    value={formState.destinationType}
                    onChange={(event) => updateField('destinationType', event.currentTarget.value)}
                    placeholder="sqlite"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="destination-config">Destination Config (JSON)</Label>
                    <Button type="button" variant="ghost" size="sm" onClick={() => prettyJsonField('destinationConfigJson')}>
                      <WandSparkles className="mr-1 h-3.5 w-3.5" /> Format
                    </Button>
                  </div>
                  <Textarea
                    id="destination-config"
                    value={formState.destinationConfigJson}
                    onChange={(event) => updateField('destinationConfigJson', event.currentTarget.value)}
                    rows={4}
                    className="font-mono text-xs"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="field-mapping">Field Mapping (JSON)</Label>
                    <Button type="button" variant="ghost" size="sm" onClick={() => prettyJsonField('fieldMappingJson')}>
                      <WandSparkles className="mr-1 h-3.5 w-3.5" /> Format
                    </Button>
                  </div>
                  <Textarea
                    id="field-mapping"
                    value={formState.fieldMappingJson}
                    onChange={(event) => updateField('fieldMappingJson', event.currentTarget.value)}
                    rows={4}
                    className="font-mono text-xs"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Trigger Type</Label>
                    <Select value={formState.triggerType} onValueChange={(value) => updateField('triggerType', value as SyncTriggerType)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select trigger" />
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
                        <SelectValue placeholder="Select status" />
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
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="trigger-config">Trigger Config (JSON)</Label>
                    <Button type="button" variant="ghost" size="sm" onClick={() => prettyJsonField('triggerConfigJson')}>
                      <WandSparkles className="mr-1 h-3.5 w-3.5" /> Format
                    </Button>
                  </div>
                  <Textarea
                    id="trigger-config"
                    value={formState.triggerConfigJson}
                    onChange={(event) => updateField('triggerConfigJson', event.currentTarget.value)}
                    rows={3}
                    className="font-mono text-xs"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="cron-expression">Cron Expression (optional)</Label>
                    <Input
                      id="cron-expression"
                      value={formState.cronExpression}
                      onChange={(event) => updateField('cronExpression', event.currentTarget.value)}
                      placeholder="*/10 * * * *"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="queue-topic">Queue Topic</Label>
                    <Input
                      id="queue-topic"
                      value={formState.queueTopic}
                      onChange={(event) => updateField('queueTopic', event.currentTarget.value)}
                      required
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                      </>
                    ) : mode === 'create' ? (
                      <>
                        <Plus className="mr-2 h-4 w-4" /> Create job
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" /> Save changes
                      </>
                    )}
                  </Button>
                  {mode === 'edit' ? (
                    <Button type="button" variant="outline" onClick={startCreate}>
                      <RotateCcw className="mr-2 h-4 w-4" /> Switch to create
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Jobs & Run Status</CardTitle>
              <CardDescription>Search, filter, and operate your sync pipelines.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="Search by name, sheet ID, sheet name, or destination"
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as JobFilter)}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Filter status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">active</SelectItem>
                    <SelectItem value="paused">paused</SelectItem>
                    <SelectItem value="archived">archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isLoading ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs...
                </div>
              ) : null}

              {!isLoading && filteredJobs.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center">
                  <p className="font-medium">No jobs matched your filters</p>
                  <p className="mt-1 text-sm text-muted-foreground">Try adjusting search terms or create a new sync job.</p>
                </div>
              ) : null}

              {!isLoading && filteredJobs.length > 0 ? (
                <div className="space-y-3">
                  {filteredJobs.map((job) => (
                    <div key={job.id} className="rounded-lg border bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{job.name}</h3>
                          <p className="text-xs text-muted-foreground">Spreadsheet: {job.sourceSpreadsheetId}</p>
                          {job.sourceSheetName ? <p className="text-xs text-muted-foreground">Sheet: {job.sourceSheetName}</p> : null}
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
                        <p>Destination: {job.destinationType}</p>
                        <p>Queue: {job.queueTopic}</p>
                        {job.lastErrorMessage ? <p className="text-destructive sm:col-span-2">Error: {job.lastErrorMessage}</p> : null}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={() => startEdit(job)}>
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => cloneIntoForm(job)}>
                          <Copy className="mr-2 h-4 w-4" /> Duplicate
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRun(job)}
                          disabled={activeJobId === job.id || job.status !== 'active'}
                          title={job.status !== 'active' ? 'Only active jobs can be run manually' : undefined}
                        >
                          {activeJobId === job.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                          Run now
                        </Button>
                        {job.status !== 'paused' ? (
                          <Button variant="outline" size="sm" onClick={() => onQuickStatusChange(job, 'paused')} disabled={activeJobId === job.id}>
                            Pause
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => onQuickStatusChange(job, 'active')} disabled={activeJobId === job.id}>
                            Resume
                          </Button>
                        )}
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
