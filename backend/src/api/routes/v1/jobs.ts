import { Router } from 'express';
import { asyncHandler } from '../../middleware/index.js';
import { createJobId } from '../../../domain/entities/index.js';
import { getJobQueue } from '../../../infrastructure/services/index.js';

const router = Router();

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
