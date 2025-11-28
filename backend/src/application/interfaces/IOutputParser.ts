/**
 * Output Parser Interface
 *
 * Abstraction for parsing output files from fire modeling engines.
 * Converts engine-specific outputs to domain ModelResult entities.
 */

import { Result } from '../common/index.js';
import { DomainError } from '../../domain/errors/index.js';
import { OutputType, OutputFormat, type ResultMetadata } from '../../domain/entities/index.js';

/**
 * Parsed output file information
 */
export interface ParsedOutput {
  /** Type of output (probability, perimeter, intensity, etc.) */
  readonly type: OutputType;
  /** File format (GeoTIFF, GeoJSON, etc.) */
  readonly format: OutputFormat;
  /** Absolute path to the output file */
  readonly filePath: string;
  /** Output metadata (dimensions, bounds, time step, etc.) */
  readonly metadata: ResultMetadata;
}

/**
 * Summary of execution from log parsing
 */
export interface ExecutionSummary {
  /** Whether execution completed successfully */
  readonly success: boolean;
  /** Total execution time in seconds */
  readonly durationSeconds?: number;
  /** Number of simulations run (for probabilistic) */
  readonly simulationCount?: number;
  /** Convergence level achieved (0-1) */
  readonly convergenceLevel?: number;
  /** Error messages found in log */
  readonly errors: string[];
  /** Warning messages found in log */
  readonly warnings: string[];
}

/**
 * Interface for output parsers.
 *
 * Implementations handle engine-specific output formats,
 * extracting files and metadata for display and export.
 *
 * @template TOutput - Output type (defaults to ParsedOutput[])
 */
export interface IOutputParser<TOutput = ParsedOutput[]> {
  /**
   * Parses all output files from a simulation directory.
   *
   * @param workingDir - Directory containing simulation outputs
   * @returns Result with parsed outputs or error
   */
  parse(workingDir: string): Promise<Result<TOutput, DomainError>>;

  /**
   * Parses the execution log file.
   *
   * @param logPath - Path to the engine's log file
   * @returns Execution summary with status and metrics
   */
  parseLog(logPath: string): Promise<ExecutionSummary>;
}
