/**
 * openNomad Example Adapters and Integration Patterns
 *
 * These examples serve as templates for agency-specific adapters.
 *
 * @module openNomad/examples
 */

// Adapter template
export {
  createAgencyAdapter,
  type AgencyAdapterOptions,
} from './ExampleAgencyAdapter.js';

// Embedded integration patterns
export {
  EmbeddedNomadDashboard,
  StyledEmbeddedDashboard,
  TokenRefreshDashboard,
  FullPageIntegrationExample,
} from './EmbeddedIntegration.js';
