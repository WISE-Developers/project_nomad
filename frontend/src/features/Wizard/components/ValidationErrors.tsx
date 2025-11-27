/**
 * Validation Errors Component
 *
 * Displays validation errors for the current wizard step.
 */

import React from 'react';
import { useWizard } from '../context/WizardContext';
import type { ValidationError } from '../types';

/**
 * Props for ValidationErrors component
 */
interface ValidationErrorsProps {
  /** Custom errors to display (overrides context errors) */
  errors?: ValidationError[];
  /** CSS class */
  className?: string;
  /** Show as inline or block */
  inline?: boolean;
}

/**
 * ValidationErrors displays error messages from step validation.
 *
 * @example
 * ```tsx
 * <ValidationErrors />
 * ```
 *
 * @example With custom errors
 * ```tsx
 * <ValidationErrors
 *   errors={[{ message: 'Custom error', type: 'error' }]}
 *   inline
 * />
 * ```
 */
export function ValidationErrors({
  errors: customErrors,
  className = '',
  inline = false,
}: ValidationErrorsProps) {
  const { getErrors } = useWizard();
  const errors = customErrors ?? getErrors();

  if (errors.length === 0) {
    return null;
  }

  const containerStyle: React.CSSProperties = {
    padding: inline ? '8px 12px' : '12px 16px',
    marginBottom: inline ? '0' : '16px',
    backgroundColor: '#ffebee',
    borderRadius: '4px',
    border: '1px solid #ffcdd2',
  };

  const listStyle: React.CSSProperties = {
    margin: 0,
    padding: errors.length > 1 ? '0 0 0 20px' : 0,
    listStyle: errors.length > 1 ? 'disc' : 'none',
  };

  const itemStyle: React.CSSProperties = {
    color: '#c62828',
    fontSize: '14px',
    marginBottom: errors.length > 1 ? '4px' : 0,
  };

  const warningItemStyle: React.CSSProperties = {
    ...itemStyle,
    color: '#e65100',
  };

  return (
    <div className={`validation-errors ${className}`} style={containerStyle} role="alert">
      {errors.length === 1 ? (
        <span style={errors[0].type === 'warning' ? warningItemStyle : itemStyle}>
          {errors[0].field && <strong>{errors[0].field}: </strong>}
          {errors[0].message}
        </span>
      ) : (
        <ul style={listStyle}>
          {errors.map((error, index) => (
            <li
              key={index}
              style={error.type === 'warning' ? warningItemStyle : itemStyle}
            >
              {error.field && <strong>{error.field}: </strong>}
              {error.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Individual field error display
 */
interface FieldErrorProps {
  /** Field name */
  field: string;
  /** CSS class */
  className?: string;
}

/**
 * FieldError shows the error for a specific field from validation.
 *
 * @example
 * ```tsx
 * <input name="email" />
 * <FieldError field="email" />
 * ```
 */
export function FieldError({ field, className = '' }: FieldErrorProps) {
  const { getErrors } = useWizard();
  const errors = getErrors();
  const fieldError = errors.find((e) => e.field === field);

  if (!fieldError) {
    return null;
  }

  const style: React.CSSProperties = {
    color: fieldError.type === 'warning' ? '#e65100' : '#c62828',
    fontSize: '12px',
    marginTop: '4px',
  };

  return (
    <span className={`field-error ${className}`} style={style} role="alert">
      {fieldError.message}
    </span>
  );
}
