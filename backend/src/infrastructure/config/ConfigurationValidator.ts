import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import { ApplicationConfig } from '../../application/interfaces/index.js';

/**
 * Validation result for configuration
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Detailed validation error
 */
export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params?: Record<string, unknown>;
}

/**
 * Configuration schema validator using JSON Schema.
 */
export class ConfigurationValidator {
  private ajv: Ajv;
  private schemaLoaded = false;
  private validateFn: ReturnType<Ajv['compile']> | null = null;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
    });
    addFormats(this.ajv);
  }

  /**
   * Loads the configuration schema from file.
   *
   * @param schemaPath - Path to the JSON schema file
   */
  loadSchema(schemaPath?: string): void {
    const defaultPath = path.resolve(
      process.cwd(),
      'backend/src/core/config/schema/config.schema.json'
    );
    const finalPath = schemaPath || defaultPath;

    try {
      if (!fs.existsSync(finalPath)) {
        console.warn(`[ConfigurationValidator] Schema not found at ${finalPath}, validation disabled`);
        return;
      }

      const schemaContent = fs.readFileSync(finalPath, 'utf-8');
      const schema = JSON.parse(schemaContent);

      this.validateFn = this.ajv.compile(schema);
      this.schemaLoaded = true;
      console.log(`[ConfigurationValidator] Schema loaded from ${finalPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ConfigurationValidator] Failed to load schema: ${message}`);
    }
  }

  /**
   * Validates a configuration object against the schema.
   *
   * @param config - Configuration object to validate
   * @returns Validation result with any errors
   */
  validate(config: unknown): ValidationResult {
    // If schema not loaded, skip validation (lenient mode)
    if (!this.schemaLoaded || !this.validateFn) {
      return { valid: true, errors: [] };
    }

    const valid = this.validateFn(config);

    if (valid) {
      return { valid: true, errors: [] };
    }

    const errors: ValidationError[] = (this.validateFn.errors || []).map((err) => ({
      path: err.instancePath || '/',
      message: err.message || 'Unknown error',
      keyword: err.keyword,
      params: err.params as Record<string, unknown>,
    }));

    return { valid: false, errors };
  }

  /**
   * Validates a configuration and throws if invalid.
   *
   * @param config - Configuration object to validate
   * @param source - Optional source description for error messages
   * @throws Error if configuration is invalid
   */
  validateOrThrow(config: unknown, source?: string): asserts config is ApplicationConfig {
    const result = this.validate(config);

    if (!result.valid) {
      const errorMessages = result.errors
        .map((e) => `  ${e.path}: ${e.message}`)
        .join('\n');
      const sourceInfo = source ? ` (from ${source})` : '';
      throw new Error(
        `Invalid configuration${sourceInfo}:\n${errorMessages}`
      );
    }
  }

  /**
   * Checks if the validator has a schema loaded.
   */
  isSchemaLoaded(): boolean {
    return this.schemaLoaded;
  }
}

/**
 * Singleton instance for configuration validation
 */
let validatorInstance: ConfigurationValidator | null = null;

/**
 * Gets the singleton ConfigurationValidator instance.
 */
export function getConfigurationValidator(): ConfigurationValidator {
  if (!validatorInstance) {
    validatorInstance = new ConfigurationValidator();
    validatorInstance.loadSchema();
  }
  return validatorInstance;
}

/**
 * Resets the validator singleton (for testing).
 */
export function resetConfigurationValidator(): void {
  validatorInstance = null;
}
