/**
 * FireSTARR Output Parser
 *
 * Parses output files from FireSTARR execution:
 * - probability_NNN_YYYY-MM-DD.tif files
 * - firestarr.log for execution summary
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { IOutputParser, ParsedOutput, ExecutionSummary } from '../../application/interfaces/IOutputParser.js';
import { Result } from '../../application/common/index.js';
import { DomainError, NotFoundError } from '../../domain/errors/index.js';
import { OutputType, OutputFormat, type ResultMetadata } from '../../domain/entities/index.js';
import {
  FIRESTARR_OUTPUT_PATTERNS,
  FIRESTARR_SUCCESS_PATTERN,
  FIRESTARR_ERROR_PATTERNS,
  FIRESTARR_WARNING_PATTERNS,
} from './types.js';

/**
 * FireSTARR-specific output parser.
 */
export class FireSTARROutputParser implements IOutputParser<ParsedOutput[]> {
  async parse(workingDir: string): Promise<Result<ParsedOutput[], DomainError>> {
    try {
      // List all files in the working directory
      const files = await readdir(workingDir);
      const outputs: ParsedOutput[] = [];

      for (const file of files) {
        // Check for probability TIF files
        const probMatch = file.match(FIRESTARR_OUTPUT_PATTERNS.PROBABILITY);
        if (probMatch) {
          const julianDay = parseInt(probMatch[1], 10);
          const dateStr = probMatch[2];
          const absolutePath = join(workingDir, file);
          const stats = await stat(absolutePath);
          // Store relative path (modelId/filename) for portability across environments
          const modelId = workingDir.split('/').pop() || '';
          const filePath = `${modelId}/${file}`;

          const metadata: ResultMetadata = {
            generatedAt: stats.mtime,
            engineVersion: '0.1.0',
            simulationDate: dateStr,
            julianDay,
          };

          outputs.push({
            type: OutputType.Probability,
            format: OutputFormat.GeoTIFF,
            filePath,
            metadata,
          });
          continue;
        }

        // Check for interim probability files
        const interimMatch = file.match(FIRESTARR_OUTPUT_PATTERNS.INTERIM_PROBABILITY);
        if (interimMatch) {
          const julianDay = parseInt(interimMatch[1], 10);
          const absolutePath = join(workingDir, file);
          const stats = await stat(absolutePath);
          // Store relative path (modelId/filename) for portability across environments
          const modelId = workingDir.split('/').pop() || '';
          const filePath = `${modelId}/${file}`;

          const metadata: ResultMetadata = {
            generatedAt: stats.mtime,
            engineVersion: '0.1.0',
            julianDay,
            interim: true,
          };

          outputs.push({
            type: OutputType.Probability,
            format: OutputFormat.GeoTIFF,
            filePath,
            metadata,
          });
        }
      }

      // Sort by julian day
      outputs.sort((a, b) => {
        const dayA = (a.metadata.julianDay as number) ?? 0;
        const dayB = (b.metadata.julianDay as number) ?? 0;
        return dayA - dayB;
      });

      console.log(`[FireSTARROutputParser] Found ${outputs.length} output files in ${workingDir}`);

      return Result.ok(outputs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ENOENT')) {
        return Result.fail(new NotFoundError('Working directory', workingDir));
      }
      console.error(`[FireSTARROutputParser] Failed to parse outputs:`, error);
      return Result.fail(new NotFoundError('Output files', workingDir));
    }
  }

  async parseLog(logPath: string): Promise<ExecutionSummary> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let success = false;
    let durationSeconds: number | undefined;
    let simulationCount: number | undefined;
    let convergenceLevel: number | undefined;

    try {
      const content = await readFile(logPath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        // Check for success pattern
        const successMatch = line.match(FIRESTARR_SUCCESS_PATTERN);
        if (successMatch) {
          success = true;
          durationSeconds = parseFloat(successMatch[1]);
        }

        // Check for error patterns
        for (const pattern of FIRESTARR_ERROR_PATTERNS) {
          const errorMatch = line.match(pattern);
          if (errorMatch) {
            errors.push(errorMatch[1]);
          }
        }

        // Check for warning patterns
        for (const pattern of FIRESTARR_WARNING_PATTERNS) {
          const warnMatch = line.match(pattern);
          if (warnMatch) {
            warnings.push(warnMatch[1]);
          }
        }

        // Check for simulation count
        const simMatch = line.match(/Running scenario (\d+) of (\d+)/);
        if (simMatch) {
          simulationCount = parseInt(simMatch[2], 10);
        }

        // Check for convergence
        const convMatch = line.match(/Convergence achieved at iteration (\d+)/);
        if (convMatch) {
          const iterations = parseInt(convMatch[1], 10);
          if (simulationCount) {
            convergenceLevel = iterations / simulationCount;
          }
        }
      }

      console.log(`[FireSTARROutputParser] Parsed log: success=${success}, duration=${durationSeconds}s, sims=${simulationCount}`);

      return {
        success,
        durationSeconds,
        simulationCount,
        convergenceLevel,
        errors,
        warnings,
      };
    } catch (error) {
      console.error(`[FireSTARROutputParser] Failed to parse log:`, error);
      return {
        success: false,
        errors: [`Failed to read log file: ${logPath}`],
        warnings: [],
      };
    }
  }

  /**
   * Gets the log file path for a working directory.
   */
  getLogPath(workingDir: string): string {
    return join(workingDir, FIRESTARR_OUTPUT_PATTERNS.LOG);
  }
}

/**
 * Singleton instance
 */
let instance: FireSTARROutputParser | null = null;

export function getFireSTARROutputParser(): IOutputParser<ParsedOutput[]> {
  if (!instance) {
    instance = new FireSTARROutputParser();
  }
  return instance;
}
