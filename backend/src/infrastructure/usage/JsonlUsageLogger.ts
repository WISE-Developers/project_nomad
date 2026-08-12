import { appendFile, mkdir, readFile, stat, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IUsageLogger } from '../../application/interfaces/IUsageLogger.js';
import type {
  IUsageQuery,
  UsageQueryOptions,
  UsageQueryResult,
} from '../../application/interfaces/IUsageQuery.js';
import type { UsageEvent } from '../../domain/value-objects/UsageEvent.js';
import { logger } from '../logging/index.js';

/** Owner-only. The log holds identities and activity patterns. */
const FILE_MODE = 0o600;

export interface JsonlUsageLoggerOptions {
  /** Absolute path to the JSONL file. */
  filePath: string;
  /**
   * Size bound in bytes. When the log exceeds this, the oldest events are
   * discarded. Omit for an unbounded log (not advisable on a field laptop).
   */
  maxBytes?: number;
  /** Called when a write fails. Defaults to the application logger. */
  onError?: (error: unknown) => void;
}

/**
 * Append-only JSONL usage log for SAN deployments (#332).
 *
 * Writes are serialised through a promise chain so concurrent record() calls
 * cannot interleave a partial line into the file.
 */
export class JsonlUsageLogger implements IUsageLogger, IUsageQuery {
  private readonly filePath: string;
  private readonly maxBytes?: number;
  private readonly onError: (error: unknown) => void;

  /** Tail of the write queue. Serialises all writes. */
  private queue: Promise<void> = Promise.resolve();

  /**
   * The current segment header - the most recent app.started event.
   *
   * Retention discards the OLDEST lines first, and the oldest line is the
   * header that makes every following event interpretable (it carries
   * auth_mode). Rotation therefore re-writes this at the top of the trimmed
   * file, or the log becomes unreadable exactly as it ages.
   */
  private segmentHeader: UsageEvent | null = null;

  constructor(options: JsonlUsageLoggerOptions) {
    if (!options.filePath) {
      throw new Error('JsonlUsageLogger requires a filePath.');
    }
    this.filePath = options.filePath;
    this.maxBytes = options.maxBytes;
    this.onError =
      options.onError ??
      ((error) =>
        logger.error(
          `Usage log write failed - usage events are being lost (${options.filePath}): ` +
            `${error instanceof Error ? error.message : String(error)}`,
          'usage',
          {
            filePath: options.filePath,
            error: error instanceof Error ? error.message : String(error),
          }
        ));
  }

  /**
   * Records one event. Never throws: a model run must not fail because its
   * usage event could not be written. Failures go to onError - loudly.
   */
  async record(event: UsageEvent): Promise<void> {
    if (event.type === 'app.started') {
      this.segmentHeader = event;
    }

    this.queue = this.queue.then(async () => {
      try {
        await this.append(event);
        await this.enforceBound();
      } catch (error) {
        this.onError(error);
      }
    });

    return this.queue;
  }

  /**
   * Reads events back, newest first.
   *
   * A malformed line is skipped rather than failing the whole query: a log
   * truncated mid-write by a full disk should still yield everything around
   * the damage. The count of skipped lines is reported so a caller is never
   * told the log is complete when it is not.
   */
  async query(options: UsageQueryOptions): Promise<UsageQueryResult> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      // No log yet is an empty log, not an error.
      return { events: [], total: 0 };
    }

    const parsed: UsageEvent[] = [];
    let skipped = 0;
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        parsed.push(JSON.parse(line) as UsageEvent);
      } catch {
        skipped++;
      }
    }
    if (skipped > 0) {
      logger.warn(
        `Usage log has ${skipped} unreadable line(s) - results are incomplete`,
        'usage',
        { filePath: this.filePath, skipped }
      );
    }

    const matching = parsed.filter((e) => {
      if (options.types && !options.types.includes(e.type)) return false;
      if (options.since && e.ts_utc < options.since) return false;
      return true;
    });

    // Newest first: ts_utc is the sort key, never ts_local.
    matching.sort((a, b) => (a.ts_utc < b.ts_utc ? 1 : a.ts_utc > b.ts_utc ? -1 : 0));

    return {
      events: matching.slice(0, options.limit),
      total: matching.length,
    };
  }

  private async append(event: UsageEvent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, {
      encoding: 'utf8',
      mode: FILE_MODE,
    });
    // appendFile's mode only applies at creation, so an existing file keeps
    // whatever permissions it had. Assert them every time instead.
    await chmod(this.filePath, FILE_MODE);
  }

  /**
   * Trims the log to the configured bound, oldest events first, then puts the
   * segment header back on top.
   */
  private async enforceBound(): Promise<void> {
    if (this.maxBytes === undefined) return;

    const { size } = await stat(this.filePath);
    if (size <= this.maxBytes) return;

    const raw = await readFile(this.filePath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.length > 0);

    // The header is re-added below, so reserve room for it rather than
    // trimming to the bound and then overflowing it again.
    const header = this.headerLine();
    const budget = this.maxBytes - (header?.length ?? 0);

    const kept: string[] = [];
    let used = 0;
    // Walk backwards: the newest events are the ones worth keeping.
    for (let i = lines.length - 1; i >= 0; i--) {
      const cost = lines[i].length + 1;
      if (used + cost > budget) break;
      kept.unshift(lines[i]);
      used += cost;
    }

    const body = header ? [header, ...kept] : kept;
    await writeFile(this.filePath, body.length ? `${body.join('\n')}\n` : '', {
      encoding: 'utf8',
      mode: FILE_MODE,
    });
    await chmod(this.filePath, FILE_MODE);
  }

  /**
   * The segment header to re-write, marked so it cannot be mistaken for a
   * genuine restart. Without the marker, anyone counting app.started events
   * would count rotation artefacts as real boots.
   */
  private headerLine(): string | null {
    if (!this.segmentHeader) return null;
    const marked = {
      ...this.segmentHeader,
      detail: { ...(this.segmentHeader.detail ?? {}), rewritten_by_rotation: true },
    };
    return JSON.stringify(marked);
  }
}

/**
 * Builds a JsonlUsageLogger from environment configuration.
 *
 * Mirrors createFileSystemFuelDatasetCatalog - the repo has no DI container,
 * so adapters expose a factory and are wired manually at the call site.
 */
export function createJsonlUsageLogger(): JsonlUsageLogger {
  const filePath = process.env.NOMAD_USAGE_LOG_PATH ?? '/data/usage/usage.jsonl';
  const rawMax = process.env.NOMAD_USAGE_LOG_MAX_BYTES;
  const maxBytes = rawMax ? Number(rawMax) : 50 * 1024 * 1024;

  if (Number.isNaN(maxBytes) || maxBytes <= 0) {
    throw new Error(
      `Invalid NOMAD_USAGE_LOG_MAX_BYTES: "${rawMax}". Must be a positive number of bytes.`
    );
  }

  return new JsonlUsageLogger({ filePath, maxBytes });
}
