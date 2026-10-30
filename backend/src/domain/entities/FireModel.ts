import { TimeRange } from '../value-objects/TimeRange.js';

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
  /** Output mode selected at model creation time (probabilistic, deterministic) */
  readonly outputMode?: string;
  /**
   * The period this model was simulated FOR — not when it executed (#482).
   *
   * Undefined when nothing records it. That is the case for the 26 runs that
   * predate this field, and it must stay undefined rather than becoming today
   * or the current year: a confident wrong start date is worse than an absent
   * one, because every downstream surface (fuel vintage, arrival-time Julian
   * anchoring) treats it as authoritative.
   */
  readonly timeRange?: TimeRange;
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

  /** Output mode selected at model creation time (probabilistic, deterministic) */
  readonly outputMode?: string;

  /** The period this model was simulated for; undefined when unrecorded (#482) */
  readonly timeRange?: TimeRange;

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
    this.timeRange = props.timeRange;
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
      // Carried deliberately. This method is called on the completion path
      // (`save(model.withStatus(Completed))`), so dropping it here would
      // persist the range at queue time and wipe it the moment the run
      // succeeded — #482 reappearing on the success path only.
      timeRange: this.timeRange,
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
      timeRange: this.timeRange,
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
