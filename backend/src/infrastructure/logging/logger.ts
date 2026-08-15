/**
 * Centralized logging service with file rotation.
 *
 * Features:
 * - Local datetime timestamps (not UTC)
 * - Daily file rotation with 14-day retention
 * - Max 50MB per file, 200MB total
 * - Separate error log file
 * - Console output in development
 * - Maintains bracketed prefix pattern: [Category] message
 */
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

// Determine log directory from env or default to ./logs
const LOG_DIR = process.env.NOMAD_LOG_DIR || path.join(process.cwd(), 'logs');

/**
 * Format timestamp in local timezone: YYYY-MM-DD HH:mm:ss.SSS
 */
function localTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Custom format for log messages.
 * Output: [2024-01-19 08:30:45.123] [INFO] [Category] Message
 */
const logFormat = winston.format.printf(({ level, message, category, correlationId }) => {
  const timestamp = localTimestamp();
  const categoryPart = category ? `[${category}] ` : '';
  const correlationPart = correlationId ? `[${correlationId}] ` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${correlationPart}${categoryPart}${message}`;
});

/**
 * Combined transport for all logs (info and above).
 */
const combinedTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'nomad-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '50m',
  maxFiles: '14d',
  zippedArchive: true,
});

/**
 * Error transport for error-level logs only.
 */
const errorTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'nomad-error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '50m',
  maxFiles: '14d',
  level: 'error',
  zippedArchive: true,
});

/**
 * Console transport for development.
 */
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    logFormat
  ),
});

// Build transport array based on environment
const transports: winston.transport[] = [
  combinedTransport,
  errorTransport,
];

// Console transport is ALWAYS added, including in production.
//
// It used to be development-only, which meant that in every containerised
// deployment nothing reached stdout: `docker logs` was empty while the
// container crash-looped. The diagnostic existed, but only in a file inside a
// container that exits - and a container that exits cannot be `docker exec`ed
// into to read it. That is worse than not logging at all, because the operator
// has no signal that a message exists.
//
// Observed on a real upgrade: a missing NOMAD_HOME_TIMEZONE produced 7 silent
// restarts with an empty log; the error was only visible by running the entry
// point by hand outside compose.
//
// In production the console format is plain (no colour) so the output stays
// readable in `docker logs` and log aggregators.
const isProductionEnv = process.env.NODE_ENV === 'production';
transports.push(
  isProductionEnv
    ? new winston.transports.Console({ format: logFormat })
    : consoleTransport
);

// Opt OUT for the rare case of a deployment that genuinely wants file-only
// logging. Defaults to console-on, because silence during a boot failure is the
// expensive direction to be wrong in.
if (process.env.NOMAD_LOG_CONSOLE === 'false') {
  transports.pop();
}

/**
 * Winston logger instance.
 */
const winstonLogger = winston.createLogger({
  level: process.env.NOMAD_LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    logFormat
  ),
  transports,
  exitOnError: false,
});

// Log rotation events
combinedTransport.on('rotate', (oldFilename, newFilename) => {
  winstonLogger.info(`Log rotated: ${path.basename(oldFilename)} -> ${path.basename(newFilename)}`, { category: 'Logger' });
});

combinedTransport.on('archive', (zipFilename) => {
  winstonLogger.debug(`Log archived: ${path.basename(zipFilename)}`, { category: 'Logger' });
});

/**
 * Logger interface matching existing console.log patterns.
 *
 * Usage:
 *   logger.info('Server started', 'Startup');
 *   logger.error('Failed to connect', 'Database', { error: err });
 *   logger.api('GET', '/api/models', 200, 45, 'abc-123');
 */
export const logger = {
  /**
   * Log informational message.
   * @param message - Log message
   * @param category - Optional category prefix (e.g., 'Startup', 'FireSTARR')
   * @param meta - Optional metadata object
   */
  info(message: string, category?: string, meta?: Record<string, unknown>): void {
    winstonLogger.info(message, { category, ...meta });
  },

  /**
   * Log warning message.
   */
  warn(message: string, category?: string, meta?: Record<string, unknown>): void {
    winstonLogger.warn(message, { category, ...meta });
  },

  /**
   * Log error message.
   */
  error(message: string, category?: string, meta?: Record<string, unknown>): void {
    winstonLogger.error(message, { category, ...meta });
  },

  /**
   * Log debug message (only in debug level).
   */
  debug(message: string, category?: string, meta?: Record<string, unknown>): void {
    winstonLogger.debug(message, { category, ...meta });
  },

  /**
   * Log API request/response.
   * @param method - HTTP method
   * @param path - Request path
   * @param statusCode - Response status code
   * @param durationMs - Request duration in milliseconds
   * @param correlationId - Request correlation ID
   */
  api(method: string, path: string, statusCode: number, durationMs: number, correlationId: string): void {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    winstonLogger.log(level, `${method} ${path} ${statusCode} (${durationMs}ms)`, {
      category: 'API',
      correlationId,
    });
  },

  /**
   * Log API request start.
   */
  apiStart(method: string, path: string, correlationId: string): void {
    winstonLogger.info(`--> ${method} ${path}`, { category: 'API', correlationId });
  },

  /**
   * Log model execution events.
   */
  model(message: string, modelId: string, meta?: Record<string, unknown>): void {
    winstonLogger.info(message, { category: 'Model', modelId, ...meta });
  },

  /**
   * Log engine-specific events (FireSTARR, WISE).
   */
  engine(message: string, engineType: string, modelId?: string, meta?: Record<string, unknown>): void {
    winstonLogger.info(message, { category: engineType, modelId, ...meta });
  },

  /**
   * Log database operations.
   */
  database(message: string, meta?: Record<string, unknown>): void {
    winstonLogger.debug(message, { category: 'Database', ...meta });
  },

  /**
   * Log startup events.
   */
  startup(message: string): void {
    winstonLogger.info(message, { category: 'Startup' });
  },

  /**
   * Get the underlying winston logger for advanced usage.
   */
  getWinstonLogger(): winston.Logger {
    return winstonLogger;
  },

  /**
   * Get the log directory path.
   */
  getLogDir(): string {
    return LOG_DIR;
  },
};

export default logger;
