import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  apiRouter,
  setupSwagger,
  requestLogger,
  notFoundHandler,
  errorHandler,
} from './api/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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
