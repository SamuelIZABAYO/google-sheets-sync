import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { SyncJobRepository } from '../db/sync-job-repository.js';
import { SyncRunRepository } from '../db/sync-run-repository.js';
import { SyncJobNotFoundError, SyncJobService } from '../services/sync-job-service.js';
import {
  QueueUnavailableError,
  SyncJobInactiveError,
  SyncJobNotFoundError as SyncRunJobNotFoundError,
  SyncRunService
} from '../services/sync-run-service.js';

const createSyncJobSchema = z.object({
  name: z.string().min(1).max(200),
  sourceSpreadsheetId: z.string().min(1).max(255),
  sourceSheetName: z.string().min(1).max(255).nullable().optional(),
  destinationType: z.string().min(1).max(100),
  destinationConfig: z.record(z.string(), z.unknown()),
  fieldMapping: z.record(z.string(), z.unknown()),
  triggerType: z.enum(['manual', 'schedule', 'webhook']).optional(),
  triggerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  cronExpression: z.string().min(1).max(255).nullable().optional(),
  queueTopic: z.string().min(1).max(100).optional()
});

const updateSyncJobSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    status: z.enum(['active', 'paused', 'archived']).optional(),
    sourceSpreadsheetId: z.string().min(1).max(255).optional(),
    sourceSheetName: z.string().min(1).max(255).nullable().optional(),
    destinationType: z.string().min(1).max(100).optional(),
    destinationConfig: z.record(z.string(), z.unknown()).optional(),
    fieldMapping: z.record(z.string(), z.unknown()).optional(),
    triggerType: z.enum(['manual', 'schedule', 'webhook']).optional(),
    triggerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
    cronExpression: z.string().min(1).max(255).nullable().optional(),
    queueTopic: z.string().min(1).max(100).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided'
  });

const idParamSchema = z.object({
  id: z.coerce.number().int().positive()
});

export async function syncJobRoutes(app: FastifyInstance) {
  const syncJobRepository = new SyncJobRepository(app.sqlite);
  const syncJobService = new SyncJobService(syncJobRepository);
  const syncRunService = new SyncRunService(syncJobRepository, new SyncRunRepository(app.sqlite), app.syncQueue);

  app.get('/sync-jobs', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;

    if (!user) {
      return reply.code(401).send({
        error: 'Invalid token'
      });
    }

    const jobs = syncJobService.listForUser(user.id);
    return reply.send({ jobs });
  });

  app.post('/sync-jobs', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;

    if (!user) {
      return reply.code(401).send({
        error: 'Invalid token'
      });
    }

    const parsedBody = createSyncJobSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: 'Invalid request body'
      });
    }

    try {
      const body = parsedBody.data;
      const job = syncJobService.create({
        userId: user.id,
        name: body.name,
        sourceSpreadsheetId: body.sourceSpreadsheetId,
        sourceSheetName: body.sourceSheetName,
        destinationType: body.destinationType,
        destinationConfigJson: JSON.stringify(body.destinationConfig),
        fieldMappingJson: JSON.stringify(body.fieldMapping),
        triggerType: body.triggerType,
        triggerConfigJson: body.triggerConfig === undefined ? undefined : JSON.stringify(body.triggerConfig),
        cronExpression: body.cronExpression,
        queueTopic: body.queueTopic
      });

      return reply.code(201).send({ job });
    } catch (error) {
      request.log.error(error, 'create sync job failed');
      return reply.code(500).send({
        error: 'Internal server error'
      });
    }
  });

  app.patch('/sync-jobs/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;

    if (!user) {
      return reply.code(401).send({
        error: 'Invalid token'
      });
    }

    const parsedParams = idParamSchema.safeParse(request.params);
    const parsedBody = updateSyncJobSchema.safeParse(request.body);

    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({
        error: 'Invalid request'
      });
    }

    try {
      const body = parsedBody.data;
      const job = syncJobService.update({
        id: parsedParams.data.id,
        userId: user.id,
        name: body.name,
        status: body.status,
        sourceSpreadsheetId: body.sourceSpreadsheetId,
        sourceSheetName: body.sourceSheetName,
        destinationType: body.destinationType,
        destinationConfigJson: body.destinationConfig ? JSON.stringify(body.destinationConfig) : undefined,
        fieldMappingJson: body.fieldMapping ? JSON.stringify(body.fieldMapping) : undefined,
        triggerType: body.triggerType,
        triggerConfigJson: body.triggerConfig === undefined ? undefined : JSON.stringify(body.triggerConfig),
        cronExpression: body.cronExpression,
        queueTopic: body.queueTopic
      });

      return reply.send({ job });
    } catch (error) {
      if (error instanceof SyncJobNotFoundError) {
        return reply.code(404).send({
          error: 'Sync job not found'
        });
      }

      request.log.error(error, 'update sync job failed');
      return reply.code(500).send({
        error: 'Internal server error'
      });
    }
  });

  app.post('/sync-jobs/:id/run', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;

    if (!user) {
      return reply.code(401).send({
        error: 'Invalid token'
      });
    }

    const parsedParams = idParamSchema.safeParse(request.params);

    if (!parsedParams.success) {
      return reply.code(400).send({
        error: 'Invalid request params'
      });
    }

    try {
      const run = await syncRunService.enqueueRun(parsedParams.data.id, user.id, 'manual');
      return reply.code(202).send({ run });
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

      request.log.error(error, 'enqueue sync run failed');
      return reply.code(500).send({
        error: 'Internal server error'
      });
    }
  });

  app.delete('/sync-jobs/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;

    if (!user) {
      return reply.code(401).send({
        error: 'Invalid token'
      });
    }

    const parsedParams = idParamSchema.safeParse(request.params);

    if (!parsedParams.success) {
      return reply.code(400).send({
        error: 'Invalid request params'
      });
    }

    try {
      syncJobService.delete(parsedParams.data.id, user.id);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof SyncJobNotFoundError) {
        return reply.code(404).send({
          error: 'Sync job not found'
        });
      }

      request.log.error(error, 'delete sync job failed');
      return reply.code(500).send({
        error: 'Internal server error'
      });
    }
  });
}
