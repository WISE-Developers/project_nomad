import { ValidationError } from '../errors/index.js';

/**
 * Immutable value object representing a time range with start, end, and duration.
 *
 * Used for model simulation periods, weather data ranges, etc.
 */
export class TimeRange {
  /** Start of the time range */
  readonly start: Date;

  /** End of the time range */
  readonly end: Date;

  constructor(start: Date, end: Date) {
    this.validateDates(start, end);
    this.start = new Date(start.getTime());
    this.end = new Date(end.getTime());
  }

  /**
   * Creates a TimeRange from a start date and duration in hours
   */
  static fromDuration(start: Date, durationHours: number): TimeRange {
    if (durationHours <= 0) {
      throw new Error('Duration must be positive');
    }
    const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
    return new TimeRange(start, end);
  }

  /**
   * Creates a TimeRange from a start date and duration in days
   */
  static fromDurationDays(start: Date, durationDays: number): TimeRange {
    return TimeRange.fromDuration(start, durationDays * 24);
  }

  /**
   * Creates a TimeRange from ISO string dates
   */
  static fromISO(startISO: string, endISO: string): TimeRange {
    const start = new Date(startISO);
    const end = new Date(endISO);
    if (isNaN(start.getTime())) {
      throw new Error(`Invalid start date: ${startISO}`);
    }
    if (isNaN(end.getTime())) {
      throw new Error(`Invalid end date: ${endISO}`);
    }
    return new TimeRange(start, end);
  }

  /**
   * Gets the duration in milliseconds
   */
  getDurationMs(): number {
    return this.end.getTime() - this.start.getTime();
  }

  /**
   * Gets the duration in seconds
   */
  getDurationSeconds(): number {
    return this.getDurationMs() / 1000;
  }

  /**
   * Gets the duration in minutes
   */
  getDurationMinutes(): number {
    return this.getDurationMs() / (1000 * 60);
  }

  /**
   * Gets the duration in hours
   */
  getDurationHours(): number {
    return this.getDurationMs() / (1000 * 60 * 60);
  }

  /**
   * Gets the duration in days
   */
  getDurationDays(): number {
    return this.getDurationMs() / (1000 * 60 * 60 * 24);
  }

  /**
   * Checks if a date falls within this range (inclusive)
   */
  contains(date: Date): boolean {
    const time = date.getTime();
    return time >= this.start.getTime() && time <= this.end.getTime();
  }

  /**
   * Checks if this range overlaps with another
   */
  overlaps(other: TimeRange): boolean {
    return this.start <= other.end && this.end >= other.start;
  }

  /**
   * Checks if this range completely contains another
   */
  encompasses(other: TimeRange): boolean {
    return this.start <= other.start && this.end >= other.end;
  }

  /**
   * Checks equality with another TimeRange
   */
  equals(other: TimeRange): boolean {
    return (
      this.start.getTime() === other.start.getTime() &&
      this.end.getTime() === other.end.getTime()
    );
  }

  /**
   * Creates a new TimeRange extended by the given hours
   */
  extendBy(hours: number): TimeRange {
    const newEnd = new Date(this.end.getTime() + hours * 60 * 60 * 1000);
    return new TimeRange(this.start, newEnd);
  }

  /**
   * Creates a new TimeRange shifted by the given hours
   */
  shiftBy(hours: number): TimeRange {
    const ms = hours * 60 * 60 * 1000;
    return new TimeRange(
      new Date(this.start.getTime() + ms),
      new Date(this.end.getTime() + ms)
    );
  }

  /**
   * Splits the range into hourly intervals
   */
  toHourlyIntervals(): TimeRange[] {
    const intervals: TimeRange[] = [];
    let current = new Date(this.start.getTime());

    while (current < this.end) {
      const next = new Date(current.getTime() + 60 * 60 * 1000);
      const intervalEnd = next > this.end ? this.end : next;
      intervals.push(new TimeRange(current, intervalEnd));
      current = next;
    }

    return intervals;
  }

  /**
   * Returns ISO string representation
   */
  toISO(): { start: string; end: string } {
    return {
      start: this.start.toISOString(),
      end: this.end.toISOString(),
    };
  }

  /**
   * Returns a formatted string representation
   */
  toString(): string {
    return `${this.start.toISOString()} to ${this.end.toISOString()} (${this.getDurationHours().toFixed(1)}h)`;
  }

  private validateDates(start: Date, end: Date): void {
    if (!(start instanceof Date) || isNaN(start.getTime())) {
      throw new ValidationError('Invalid time range', [
        { field: 'timeRange.start', message: 'Invalid start date' },
      ]);
    }
    if (!(end instanceof Date) || isNaN(end.getTime())) {
      throw new ValidationError('Invalid time range', [
        { field: 'timeRange.end', message: 'Invalid end date' },
      ]);
    }
    if (end <= start) {
      throw new ValidationError('Invalid time range', [
        { field: 'timeRange', message: 'End date must be after start date' },
      ]);
    }
  }
}
