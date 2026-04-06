import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SyncJobRepository } from '../db/sync-job-repository.js';
import {
  QueueUnavailableError,
  SyncJobInactiveError,
  SyncJobNotFoundError as SyncRunJobNotFoundError,
  SyncRunService
} from '../services/sync-run-service.js';
import { SyncRunRepository } from '../db/sync-run-repository.js';

const webhookParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const webhookBodySchema = z.object({
  event: z.string().trim().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().datetime({ offset: true }).optional()
});

const webhookTriggerConfigSchema = z.object({
  secret: z.string().trim().min(16).max(256),
  allowedEvents: z.array(z.string().trim().min(1).max(100)).optional()
});

export async function webhookRoutes(app: FastifyInstance) {
  const syncJobRepository = new SyncJobRepository(app.sqlite);
  const syncRunService = new SyncRunService(syncJobRepository, new SyncRunRepository(app.sqlite), app.syncQueue);

  app.post('/webhooks/sync-jobs/:id/trigger', async (request, reply) => {
    const parsedParams = webhookParamsSchema.safeParse(request.params);
    const parsedBody = webhookBodySchema.safeParse(request.body);

    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({
        error: 'Invalid webhook request'
      });
    }

    const job = syncJobRepository.findById(parsedParams.data.id);

    if (!job || job.status === 'archived') {
      return reply.code(404).send({
        error: 'Sync job not found'
      });
    }

    if (job.triggerType !== 'webhook') {
      return reply.code(400).send({
        error: 'Sync job is not configured for webhook trigger'
      });
    }

    let rawTriggerConfig: unknown = null;
    try {
      rawTriggerConfig = job.triggerConfigJson ? JSON.parse(job.triggerConfigJson) : null;
    } catch (error) {
      request.log.error({ error, jobId: job.id }, 'failed to parse webhook trigger configuration');
      return reply.code(500).send({
        error: 'Webhook trigger misconfigured'
      });
    }

    const triggerConfigParsed = webhookTriggerConfigSchema.safeParse(rawTriggerConfig);

    if (!triggerConfigParsed.success) {
      request.log.error({ jobId: job.id }, 'invalid webhook trigger configuration');
      return reply.code(500).send({
        error: 'Webhook trigger misconfigured'
      });
    }

    const providedSecret = request.headers['x-webhook-secret'];

    if (typeof providedSecret !== 'string' || providedSecret.length === 0) {
      return reply.code(401).send({
        error: 'Invalid webhook secret'
      });
    }

    if (providedSecret !== triggerConfigParsed.data.secret) {
      return reply.code(401).send({
        error: 'Invalid webhook secret'
      });
    }

    const allowedEvents = triggerConfigParsed.data.allowedEvents;
    if (allowedEvents && !allowedEvents.includes(parsedBody.data.event)) {
      return reply.code(400).send({
        error: 'Webhook event not allowed'
      });
    }

    try {
      const run = await syncRunService.enqueueRun(job.id, job.userId, 'webhook');

      return reply.code(202).send({
        run,
        acceptedEvent: parsedBody.data.event
      });
    } catch (error) {
      if (error instanceof SyncRunJobNotFoundError) {
        return reply.code(404).send({
          error: 'Sync job not found'
        });
      }

      if (error instanceof SyncJobInactiveError) {
        return reply.code(400).send({
          error: 'Sync job is not active'
        });
      }

      if (error instanceof QueueUnavailableError) {
        return reply.code(503).send({
          error: 'Sync queue unavailable'
        });
      }

      request.log.error(error, 'webhook enqueue failed');
      return reply.code(500).send({
        error: 'Internal server error'
      });
    }
  });
}
