import express from 'express';
import cors, { CorsOptions } from 'cors';
import dotenv from 'dotenv';
import { resolve, join, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
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
import { logger } from './infrastructure/logging/index.js';

// Load .env from project root (parent directory)
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

/**
 * Initialize database and repositories
 */
async function initializeDatabaseLayer(): Promise<void> {
  logger.startup('Initializing database...');
  await initDatabase();

  // Initialize repositories (database-agnostic layer)
  initializeRepositories();
  logger.startup('Repositories initialized');

  // Startup recovery: mark interrupted jobs as failed
  const jobRepo = getJobRepository();
  const count = await jobRepo.markRunningAsFailed();
  if (count > 0) {
    logger.startup(`Marked ${count} interrupted jobs as failed`);
  }

  logger.startup('Database ready');
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

    logger.info(`ACN mode - allowed origins: ${allowedOrigins.join(', ') || '(none)'}`, 'CORS');

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
          logger.warn(`Blocked origin: ${origin}`, 'CORS');
          callback(new Error(`Origin ${origin} not allowed`));
        }
      },
      credentials: true,
    };
  }

  // SAN mode: allow all origins.
  // SAN is a single-user standalone deployment on a trusted network.
  // Auth is header-based (X-Nomad-User), not cookie-based, so CORS
  // provides no meaningful CSRF protection. The server also cannot
  // reliably determine its external origin when behind Docker port
  // mapping (container sees :3001, browser sees :3901).
  // Cross-origin protection is enforced in ACN mode instead.
  return {
    origin: true,
    credentials: true,
  };
}

// ============================================
// Static File Serving (Production Mode)
// ============================================
// Mounted BEFORE CORS/auth middleware — static files don't need CORS checks.
// Vite emits <script type="module" crossorigin> which causes browsers to send
// an Origin header even for same-origin requests. The SAN CORS policy blocks
// all requests with an Origin header, so static files must bypass it entirely.

const isProduction = process.env.NODE_ENV === 'production';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendDistPath = resolve(__dirname, '../../frontend/dist');

if (isProduction && existsSync(frontendDistPath)) {
  logger.startup(`Production mode: serving frontend from ${frontendDistPath}`);

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
  logger.warn(`Production mode but frontend not found at ${frontendDistPath}`, 'Startup');
  logger.warn('Run "npm run build" to build the frontend', 'Startup');
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

// ============================================
// MCP Server (optional, behind feature flag)
// Mounted BEFORE auth middleware — MCP uses its own session-based auth.
// The MCP endpoint only exists when explicitly opted in via NOMAD_ENABLE_MCP=true.
// ============================================

if (process.env.NOMAD_ENABLE_MCP === 'true') {
  const { mountMcpServer } = await import('./mcp/index.js');
  mountMcpServer(app);
}

// 4. Authentication - mode-specific
if (process.env.NOMAD_DEPLOYMENT_MODE === 'ACN') {
  logger.startup('ACN mode: Agency authentication enabled');
  app.use(acnAuthMiddleware);
} else {
  logger.startup('SAN mode: Simple authentication enabled');
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
    // Log startup with log directory info
    logger.startup(`Log directory: ${logger.getLogDir()}`);

    // Initialize database first
    await initializeDatabaseLayer();

    // Start listening
    app.listen(PORT, () => {
      logger.startup(`Server started on port ${PORT}`);
      logger.startup(`API: http://localhost:${PORT}/api/v1`);
      logger.startup(`Docs: http://localhost:${PORT}/api/docs`);
      // Also log to console for visual banner (even in production)
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
    logger.error(`Failed to start server: ${error}`, 'Startup');
    process.exit(1);
  }
}

// Start the server
startServer();
