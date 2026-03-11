/**
 * Branded type for FireModel IDs to provide type-safe identification
 */
declare const FireModelIdBrand: unique symbol;
export type FireModelId = string & { readonly [FireModelIdBrand]: typeof FireModelIdBrand };

/**
 * Creates a FireModelId from a string
 */
export function createFireModelId(id: string): FireModelId {
  if (!id || id.trim().length === 0) {
    throw new Error('FireModelId cannot be empty');
  }
  return id as FireModelId;
}

/**
 * Available fire modeling engines
 */
export enum EngineType {
  FireSTARR = 'firestarr',
  WISE = 'wise',
}

/**
 * Status of a fire model throughout its lifecycle
 */
export enum ModelStatus {
  /** Initial state, not yet submitted */
  Draft = 'draft',
  /** Submitted and waiting for execution */
  Queued = 'queued',
  /** Currently being executed */
  Running = 'running',
  /** Execution completed successfully */
  Completed = 'completed',
  /** Execution failed */
  Failed = 'failed',
}

/**
 * Properties required to create a FireModel
 */
export interface FireModelProps {
  readonly id: FireModelId;
  readonly name: string;
  readonly engineType: EngineType;
  readonly status?: ModelStatus;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
  /** User who created this model (for ownership filtering) */
  readonly userId?: string;
  /** Optional user-provided notes for this model run */
  readonly notes?: string;
  /** Output mode selected at model creation time (probabilistic, pseudo-deterministic) */
  readonly outputMode?: string;
}

/**
 * Core domain entity representing a fire modeling job.
 *
 * A FireModel represents a single fire behavior simulation request,
 * tracking its configuration, status, and lifecycle through execution.
 */
export class FireModel {
  /** Unique identifier for this model */
  readonly id: FireModelId;

  /** User-provided name for the model */
  readonly name: string;

  /** The fire modeling engine to use */
  readonly engineType: EngineType;

  /** Current status in the execution lifecycle */
  readonly status: ModelStatus;

  /** When this model was created */
  readonly createdAt: Date;

  /** When this model was last updated */
  readonly updatedAt: Date;

  /** User who created this model (for ownership filtering) */
  readonly userId?: string;

  /** Optional user-provided notes for this model run */
  readonly notes?: string;

  /** Output mode selected at model creation time (probabilistic, pseudo-deterministic) */
  readonly outputMode?: string;

  constructor(props: FireModelProps) {
    if (!props.name || props.name.trim().length === 0) {
      throw new Error('FireModel name cannot be empty');
    }

    this.id = props.id;
    this.name = props.name.trim();
    this.engineType = props.engineType;
    this.status = props.status ?? ModelStatus.Draft;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
    this.userId = props.userId;
    this.notes = props.notes;
    this.outputMode = props.outputMode;
  }

  /**
   * Creates a new FireModel with updated status
   */
  withStatus(status: ModelStatus): FireModel {
    return new FireModel({
      id: this.id,
      name: this.name,
      engineType: this.engineType,
      status,
      createdAt: this.createdAt,
      updatedAt: new Date(),
      userId: this.userId,
      notes: this.notes,
      outputMode: this.outputMode,
    });
  }

  /**
   * Creates a new FireModel with updated name
   */
  withName(name: string): FireModel {
    return new FireModel({
      id: this.id,
      name,
      engineType: this.engineType,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: new Date(),
      userId: this.userId,
      notes: this.notes,
      outputMode: this.outputMode,
    });
  }

  /**
   * Check if the model can be executed
   */
  canExecute(): boolean {
    return this.status === ModelStatus.Draft || this.status === ModelStatus.Failed;
  }

  /**
   * Check if the model is in a terminal state
   */
  isTerminal(): boolean {
    return this.status === ModelStatus.Completed || this.status === ModelStatus.Failed;
  }
}
