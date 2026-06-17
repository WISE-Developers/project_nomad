import { Router } from 'express';
import { readFile, stat } from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import { join } from 'path';
import { asyncHandler } from '../../middleware/index.js';
import { createJobId, EngineType } from '../../../domain/entities/index.js';
import { getJobQueue } from '../../../infrastructure/services/index.js';
import { getWorkspaceAwareEngine } from '../../../infrastructure/engines/index.js';

const router = Router();

/**
 * @openapi
 * /jobs/{id}/stream:
 *   get:
 *     summary: Stream job status updates (SSE)
 *     description: Server-Sent Events endpoint for real-time job status updates
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *     responses:
 *       200:
 *         description: SSE stream of job status updates
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/jobs/:id/stream',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const jobId = createJobId(id);
    const jobQueue = getJobQueue();

    // Verify job exists
    const initialResult = await jobQueue.getJob(jobId);
    if (!initialResult.success) {
      throw initialResult.error;
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send initial status
    const sendStatus = (job: { toJSON(): unknown }) => {
      res.write(`data: ${JSON.stringify(job.toJSON())}\n\n`);
    };

    sendStatus(initialResult.value);

    // If job is already terminal, close connection
    if (initialResult.value.isTerminal()) {
      res.write('event: complete\ndata: {}\n\n');
      res.end();
      return;
    }

    // Poll for updates
    const pollInterval = setInterval(async () => {
      const result = await jobQueue.getJob(jobId);
      if (!result.success) {
        clearInterval(pollInterval);
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
        res.end();
        return;
      }

      const job = result.value;
      sendStatus(job);

      // Check if job is terminal
      if (job.isTerminal()) {
        clearInterval(pollInterval);
        res.write('event: complete\ndata: {}\n\n');
        res.end();
      }
    }, 1000); // Poll every second

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(pollInterval);
    });
  })
);

/**
 * @openapi
 * /jobs/{id}/log-stream:
 *   get:
 *     summary: Stream FireSTARR log output (SSE)
 *     description: |
 *       Reads the firestarr.log file for a job's model, sends all existing lines,
 *       then tails new lines as they're written. Connection-scoped — fs.watch only
 *       runs while a client is connected.
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *     responses:
 *       200:
 *         description: SSE stream of log lines
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/jobs/:id/log-stream',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const jobId = createJobId(id);
    const jobQueue = getJobQueue();

    // Verify job exists and get modelId
    const jobResult = await jobQueue.getJob(jobId);
    if (!jobResult.success) {
      throw jobResult.error;
    }

    const modelId = jobResult.value.modelId;

    // Find the working directory for this model
    const engine = getWorkspaceAwareEngine(EngineType.FireSTARR);
    const workingDir = engine.getWorkingDirectory(modelId);
    if (!workingDir) {
      res.status(404).json({ error: 'Working directory not found for model' });
      return;
    }

    const logPath = join(workingDir, 'firestarr.log');

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendLine = (line: string) => {
      try {
        res.write(`event: log\ndata: ${JSON.stringify({ line })}\n\n`);
      } catch {
        // Connection may be closed
      }
    };

    // Read existing file content and send all lines
    let offset = 0;
    try {
      const content = await readFile(logPath, 'utf-8');
      offset = Buffer.byteLength(content, 'utf-8');
      const lines = content.split('\n').filter((l) => l.length > 0);
      for (const line of lines) {
        sendLine(line);
      }
    } catch {
      // File doesn't exist yet — that's fine, we'll watch for it
    }

    // Tail new content via fs.watch
    let watcher: FSWatcher | null = null;
    let closed = false;

    const startWatching = () => {
      try {
        watcher = watch(logPath, async (eventType) => {
          if (closed || eventType !== 'change') return;
          try {
            const fileStat = await stat(logPath);
            if (fileStat.size <= offset) return;

            // Read only the new bytes
            const { open } = await import('fs/promises');
            const fh = await open(logPath, 'r');
            const buf = Buffer.alloc(fileStat.size - offset);
            await fh.read(buf, 0, buf.length, offset);
            await fh.close();
            offset = fileStat.size;

            const newContent = buf.toString('utf-8');
            const lines = newContent.split('\n').filter((l) => l.length > 0);
            for (const line of lines) {
              sendLine(line);
            }
          } catch {
            // File may have been deleted or rotated
          }
        });
      } catch {
        // File doesn't exist yet — poll until it does
        const poll = setInterval(async () => {
          if (closed) {
            clearInterval(poll);
            return;
          }
          try {
            await stat(logPath);
            clearInterval(poll);
            // File appeared — read it and start watching
            const content = await readFile(logPath, 'utf-8');
            offset = Buffer.byteLength(content, 'utf-8');
            const lines = content.split('\n').filter((l) => l.length > 0);
            for (const line of lines) {
              sendLine(line);
            }
            startWatching();
          } catch {
            // Still waiting
          }
        }, 1000);
      }
    };

    startWatching();

    // Send completion event when job finishes
    const checkInterval = setInterval(async () => {
      if (closed) {
        clearInterval(checkInterval);
        return;
      }
      const result = await jobQueue.getJob(jobId);
      if (result.success && result.value.isTerminal()) {
        // Give a moment for final log writes to flush
        setTimeout(() => {
          clearInterval(checkInterval);
          res.write('event: complete\ndata: {}\n\n');
        }, 2000);
      }
    }, 2000);

    // Clean up on client disconnect
    req.on('close', () => {
      closed = true;
      clearInterval(checkInterval);
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    });
  })
);

/**
 * @openapi
 * /jobs/{id}:
 *   get:
 *     summary: Get job status
 *     description: Returns the current status of a model execution job
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Job'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const jobQueue = getJobQueue();

    const result = await jobQueue.getJob(createJobId(id));
    if (!result.success) {
      throw result.error;
    }

    res.json(result.value.toJSON());
  })
);

/**
 * @openapi
 * /jobs/{id}:
 *   delete:
 *     summary: Cancel a job
 *     description: Cancels a running or pending job
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job cancelled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Job'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       400:
 *         description: Job cannot be cancelled (already completed or failed)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const jobQueue = getJobQueue();

    const result = await jobQueue.cancel(createJobId(id));
    if (!result.success) {
      throw result.error;
    }

    res.json(result.value.toJSON());
  })
);

/**
 * @openapi
 * /jobs:
 *   get:
 *     summary: List jobs
 *     description: Returns all jobs, optionally filtered by status
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, running, completed, failed, cancelled]
 *         description: Filter by job status
 *     responses:
 *       200:
 *         description: List of jobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Job'
 *                 total:
 *                   type: number
 */
router.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const jobQueue = getJobQueue();

    let jobs;
    if (status === 'pending') {
      jobs = await jobQueue.getQueuedJobs();
    } else if (status === 'running') {
      jobs = await jobQueue.getRunningJobs();
    } else {
      // Return all queued and running jobs by default
      const queued = await jobQueue.getQueuedJobs();
      const running = await jobQueue.getRunningJobs();
      jobs = [...queued, ...running];
    }

    res.json({
      jobs: jobs.map((job) => job.toJSON()),
      total: jobs.length,
    });
  })
);

export default router;
