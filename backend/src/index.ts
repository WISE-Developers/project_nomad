import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { resolve } from 'path';
import {
  apiRouter,
  setupSwagger,
  requestLogger,
  notFoundHandler,
  errorHandler,
} from './api/index.js';
import { initDatabase, initializeRepositories, getJobRepository } from './infrastructure/database/index.js';

// Load .env from project root (parent directory)
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

/**
 * Initialize database and repositories
 */
async function initializeDatabaseLayer(): Promise<void> {
  console.log('[Startup] Initializing database...');
  await initDatabase();

  // Initialize repositories (database-agnostic layer)
  initializeRepositories();
  console.log('[Startup] Repositories initialized');

  // Startup recovery: mark interrupted jobs as failed
  const jobRepo = getJobRepository();
  const count = await jobRepo.markRunningAsFailed();
  if (count > 0) {
    console.log(`[Startup] Marked ${count} interrupted jobs as failed`);
  }

  console.log('[Startup] Database ready');
}

// ============================================
// Middleware (order matters!)
// ============================================

// 1. CORS
app.use(cors());

// 2. JSON body parser with size limit (10mb for large geometries)
app.use(express.json({ limit: '10mb' }));

// 3. Request logging
app.use(requestLogger);

// ============================================
// Routes
// ============================================

// API routes (versioned)
app.use('/api', apiRouter);

// Swagger UI documentation
setupSwagger(app);

// Legacy health check (for backwards compatibility)
app.get('/api/health', (_req, res) => {
  res.redirect('/api/v1/health');
});

// ============================================
// Error Handling (must be last)
// ============================================

// 404 handler for unknown routes
app.use(notFoundHandler);

// Central error handler
app.use(errorHandler);

// ============================================
// Server Startup
// ============================================

async function startServer(): Promise<void> {
  try {
    // Initialize database first
    await initializeDatabaseLayer();

    // Start listening
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════╗
║         Project Nomad Backend              ║
╠════════════════════════════════════════════╣
║  Server:  http://localhost:${PORT}             ║
║  API:     http://localhost:${PORT}/api/v1      ║
║  Docs:    http://localhost:${PORT}/api/docs    ║
╚════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('[Startup] Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
