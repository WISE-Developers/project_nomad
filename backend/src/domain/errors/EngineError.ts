import { DomainError } from './DomainError.js';
import { EngineType } from '../entities/index.js';

/**
 * Specific engine error codes
 */
export enum EngineErrorCode {
  /** Engine initialization failed */
  INITIALIZATION_FAILED = 'ENGINE_INITIALIZATION_FAILED',
  /** Model execution failed */
  EXECUTION_FAILED = 'ENGINE_EXECUTION_FAILED',
  /** Engine timed out */
  TIMEOUT = 'ENGINE_TIMEOUT',
  /** Engine not available */
  UNAVAILABLE = 'ENGINE_UNAVAILABLE',
  /** Invalid engine configuration */
  INVALID_CONFIG = 'ENGINE_INVALID_CONFIG',
  /** Engine cancelled by user */
  CANCELLED = 'ENGINE_CANCELLED',
  /** A cancel could not confirm the engine stopped */
  CANCEL_FAILED = 'ENGINE_CANCEL_FAILED',
  /** Output processing failed */
  OUTPUT_FAILED = 'ENGINE_OUTPUT_FAILED',
  /** Location not supported by engine */
  LOCATION_NOT_SUPPORTED = 'ENGINE_LOCATION_NOT_SUPPORTED',
}

/**
 * Error for fire modeling engine failures.
 *
 * Used when:
 * - Engine initialization fails
 * - Model execution fails
 * - Engine times out
 * - Output processing fails
 * - Engine is unavailable
 */
export class EngineError extends DomainError {
  readonly code: string;
  readonly httpStatus = 500;

  /**
   * Specific error code
   */
  readonly errorCode: EngineErrorCode;

  /**
   * Engine that failed
   */
  readonly engineType: EngineType;

  /**
   * Exit code from engine process (if applicable)
   */
  readonly exitCode?: number;

  /**
   * Engine log output (if available)
   */
  readonly engineLog?: string;

  constructor(
    errorCode: EngineErrorCode,
    engineType: EngineType,
    message: string,
    options?: {
      exitCode?: number;
      engineLog?: string;
      context?: Record<string, unknown>;
    }
  ) {
    super(message, options?.context);
    this.code = errorCode;
    this.errorCode = errorCode;
    this.engineType = engineType;
    this.exitCode = options?.exitCode;
    this.engineLog = options?.engineLog;
  }

  /**
   * Creates an initialization error
   */
  static initializationFailed(engineType: EngineType, reason: string): EngineError {
    return new EngineError(
      EngineErrorCode.INITIALIZATION_FAILED,
      engineType,
      `${engineType} initialization failed: ${reason}`
    );
  }

  /**
   * Creates an execution error
   */
  static executionFailed(
    engineType: EngineType,
    reason: string,
    exitCode?: number,
    engineLog?: string
  ): EngineError {
    return new EngineError(
      EngineErrorCode.EXECUTION_FAILED,
      engineType,
      `${engineType} execution failed: ${reason}`,
      { exitCode, engineLog }
    );
  }

  /**
   * Creates a timeout error
   */
  static timeout(engineType: EngineType, timeoutMinutes: number): EngineError {
    return new EngineError(
      EngineErrorCode.TIMEOUT,
      engineType,
      `${engineType} timed out after ${timeoutMinutes} minutes`
    );
  }

  /**
   * Creates an unavailable error
   */
  static unavailable(engineType: EngineType, reason?: string): EngineError {
    return new EngineError(
      EngineErrorCode.UNAVAILABLE,
      engineType,
      `${engineType} is not available${reason ? `: ${reason}` : ''}`
    );
  }

  /**
   * Creates a cancelled error
   */
  static cancelled(engineType: EngineType): EngineError {
    return new EngineError(
      EngineErrorCode.CANCELLED,
      engineType,
      `${engineType} execution was cancelled`
    );
  }

  /**
   * Creates an output processing error
   */
  /** A cancel could not confirm that the engine stopped, so nothing was cancelled. */
  static cancelFailed(engineType: EngineType, reason: string): EngineError {
    return new EngineError(EngineErrorCode.CANCEL_FAILED, engineType, reason);
  }

  static outputFailed(engineType: EngineType, reason: string): EngineError {
    return new EngineError(
      EngineErrorCode.OUTPUT_FAILED,
      engineType,
      `${engineType} output processing failed: ${reason}`
    );
  }

  /**
   * Creates a location not supported error
   */
  static locationNotSupported(
    engineType: EngineType,
    reason: string,
    context?: Record<string, unknown>
  ): EngineError {
    return new EngineError(
      EngineErrorCode.LOCATION_NOT_SUPPORTED,
      engineType,
      `Location not supported by ${engineType}: ${reason}`,
      { context }
    );
  }

  /**
   * Checks if this is a retryable error
   */
  isRetryable(): boolean {
    return [
      EngineErrorCode.TIMEOUT,
      EngineErrorCode.UNAVAILABLE,
    ].includes(this.errorCode);
  }

  override toJSON(): {
    name: string;
    code: string;
    message: string;
    errorCode: EngineErrorCode;
    engineType: EngineType;
    exitCode?: number;
    context?: Record<string, unknown>;
  } {
    return {
      ...super.toJSON(),
      errorCode: this.errorCode,
      engineType: this.engineType,
      ...(this.exitCode !== undefined && { exitCode: this.exitCode }),
    };
  }
}
