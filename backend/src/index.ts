import express from 'express';
import cors, { CorsOptions } from 'cors';
import dotenv from 'dotenv';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import {
  apiRouter,
  setupSwagger,
  requestLogger,
  notFoundHandler,
  errorHandler,
  acnAuthMiddleware,
  simpleAuthMiddleware,
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
// CORS Configuration
// ============================================

/**
 * Gets CORS options based on deployment mode.
 *
 * - SAN mode: Allow all origins (for local/standalone deployments)
 * - ACN mode: Restrict to registered agency origins
 */
function getCorsOptions(): CorsOptions {
  const mode = process.env.NOMAD_DEPLOYMENT_MODE || 'SAN';

  if (mode === 'ACN') {
    // Collect allowed origins from NOMAD_AGENCY_ORIGINS_* env vars
    const allowedOrigins: string[] = [];
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('NOMAD_AGENCY_ORIGINS_') && value) {
        allowedOrigins.push(...value.split(',').map((o) => o.trim()));
      }
    }

    // Also allow NOMAD_CORS_ORIGINS for additional origins
    if (process.env.NOMAD_CORS_ORIGINS) {
      allowedOrigins.push(...process.env.NOMAD_CORS_ORIGINS.split(',').map((o) => o.trim()));
    }

    console.log(`[CORS] ACN mode - allowed origins: ${allowedOrigins.join(', ') || '(none)'}`);

    return {
      origin: (origin, callback) => {
        // Allow requests with no origin (same-origin, curl, etc.)
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.warn(`[CORS] Blocked origin: ${origin}`);
          callback(new Error(`Origin ${origin} not allowed`));
        }
      },
      credentials: true,
    };
  }

  // SAN mode: allow all origins
  console.log('[CORS] SAN mode - all origins allowed');
  return {
    origin: true,
    credentials: true,
  };
}

// ============================================
// Middleware (order matters!)
// ============================================

// 1. CORS - configured based on deployment mode
const corsOptions = getCorsOptions();
app.use(cors(corsOptions));

// 2. JSON body parser with size limit (10mb for large geometries)
app.use(express.json({ limit: '10mb' }));

// 3. Request logging
app.use(requestLogger);

// 4. Authentication - mode-specific
if (process.env.NOMAD_DEPLOYMENT_MODE === 'ACN') {
  console.log('[Startup] ACN mode: Agency authentication enabled');
  app.use(acnAuthMiddleware);
} else {
  console.log('[Startup] SAN mode: Simple authentication enabled');
  app.use(simpleAuthMiddleware);
}

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
// Static File Serving (Production Mode)
// ============================================

/**
 * In production mode, serve the built frontend from frontend/dist.
 * This allows running a single server for both API and UI.
 *
 * The frontend dist path is relative to the backend dist directory:
 * - Backend runs from: backend/dist/index.js
 * - Frontend built to: frontend/dist/
 * - Relative path: ../../frontend/dist
 */
const isProduction = process.env.NODE_ENV === 'production';
const frontendDistPath = resolve(__dirname, '../../frontend/dist');

if (isProduction && existsSync(frontendDistPath)) {
  console.log(`[Startup] Production mode: serving frontend from ${frontendDistPath}`);

  // Serve static files (JS, CSS, images, etc.)
  app.use(express.static(frontendDistPath));

  // SPA catch-all: serve index.html for any non-API route
  // This enables client-side routing (React Router, etc.)
  app.get('*', (req, res, next) => {
    // Skip API routes - let them fall through to 404 handler
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(join(frontendDistPath, 'index.html'));
  });
} else if (isProduction) {
  console.warn(`[Startup] Production mode but frontend not found at ${frontendDistPath}`);
  console.warn('[Startup] Run "npm run build" to build the frontend');
}

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
