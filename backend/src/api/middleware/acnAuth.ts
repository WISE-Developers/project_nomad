/**
 * ACN Auth Middleware
 *
 * Authenticates requests from agency applications in ACN (Agency Centric Nomad) mode.
 *
 * ## Trust Model
 *
 * Nomad trusts registered agencies completely. The agency validates its users
 * (via FusionAuth, Okta, Azure AD, etc.) and forwards identity via headers.
 * Nomad validates:
 * 1. The agency is registered (via X-Nomad-Agency-Key)
 * 2. The role is a valid Nomad role
 *
 * ## Required Headers
 *
 * - X-Nomad-Agency-Id: Agency identifier (e.g., 'gnwt')
 * - X-Nomad-Agency-Key: Secret key proving agency identity
 * - X-Nomad-User-Id: Unique user identifier from agency IdP
 * - X-Nomad-User-Role: Nomad role (admin|fban|modeler|user|anonymous)
 * - X-Nomad-User-Name: Display name for audit logging (optional but recommended)
 */

import { Request, Response, NextFunction } from 'express';

// =============================================================================
// Types
// =============================================================================

/**
 * Valid Nomad user roles from most to least privileged.
 */
export const VALID_ROLES = ['admin', 'fban', 'modeler', 'user', 'anonymous'] as const;
export type NomadRole = (typeof VALID_ROLES)[number];

/**
 * Agency identity extracted from request headers.
 */
export interface AgencyIdentity {
  /** Agency identifier (e.g., 'gnwt', 'ontario', 'alberta') */
  id: string;
  /** The validated agency key (for logging, not exposed) */
  keyPrefix: string;
}

/**
 * User identity extracted from request headers.
 */
export interface UserIdentity {
  /** Unique user identifier from agency IdP */
  id: string;
  /** User's display name */
  name: string;
  /** User's role in Nomad */
  role: NomadRole;
}

/**
 * ACN request context populated by middleware.
 */
export interface ACNContext {
  agency: AgencyIdentity;
  user: UserIdentity;
}

// Extend Express Request type.
//
// `namespace` is not a style choice here: augmenting Express's Request is only
// possible by merging into the global Express namespace it declares. There is
// no module-syntax equivalent, so no-namespace cannot be satisfied without
// giving up the augmentation entirely. Accepted deliberately (#386).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      acn?: ACNContext;
    }
  }
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Registered agency configuration.
 *
 * In production, this would come from a config service or database.
 * For now, we use environment variables: NOMAD_AGENCY_KEY_{AGENCY_ID}
 */
export interface AgencyRegistration {
  id: string;
  key: string;
  name: string;
  allowedOrigins: string[];
}

/**
 * Gets registered agencies from environment variables.
 *
 * Environment variable format: NOMAD_AGENCY_KEY_{AGENCY_ID}=secret-key
 * Example: NOMAD_AGENCY_KEY_GNWT=my-secret-key
 *
 * Additional config: NOMAD_AGENCY_ORIGINS_{AGENCY_ID}=origin1,origin2
 * Example: NOMAD_AGENCY_ORIGINS_GNWT=https://em3.gov.nt.ca,https://em3-dev.gov.nt.ca
 */
function getRegisteredAgencies(): Map<string, AgencyRegistration> {
  const agencies = new Map<string, AgencyRegistration>();

  for (const [key, value] of Object.entries(process.env)) {
    const keyMatch = key.match(/^NOMAD_AGENCY_KEY_(\w+)$/);
    if (keyMatch && value) {
      const agencyId = keyMatch[1].toLowerCase();
      const originsKey = `NOMAD_AGENCY_ORIGINS_${keyMatch[1]}`;
      const origins = process.env[originsKey]?.split(',').map((o) => o.trim()) || [];

      agencies.set(agencyId, {
        id: agencyId,
        key: value,
        name: agencyId.toUpperCase(), // Could be enhanced with proper names
        allowedOrigins: origins,
      });
    }
  }

  return agencies;
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * ACN authentication middleware.
 *
 * Validates agency credentials and extracts user identity from headers.
 * Only active when NOMAD_DEPLOYMENT_MODE=ACN.
 *
 * @example
 * ```typescript
 * // In Express app setup
 * if (deploymentMode === 'ACN') {
 *   app.use(acnAuthMiddleware);
 * }
 *
 * // In route handler
 * app.get('/api/models', (req, res) => {
 *   const { agency, user } = req.acn!;
 *   console.log(`Request from ${agency.id} user ${user.id}`);
 * });
 * ```
 */
export function acnAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip if not in ACN mode
  if (process.env.NOMAD_DEPLOYMENT_MODE !== 'ACN') {
    return next();
  }

  // Extract headers
  const agencyId = getHeader(req, 'x-nomad-agency-id');
  const agencyKey = getHeader(req, 'x-nomad-agency-key');
  const userId = getHeader(req, 'x-nomad-user-id');
  const userRole = getHeader(req, 'x-nomad-user-role');
  const userName = getHeader(req, 'x-nomad-user-name') || 'Unknown User';

  // Validate required headers
  if (!agencyId || !agencyKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing agency credentials. Required: X-Nomad-Agency-Id, X-Nomad-Agency-Key',
    });
    return;
  }

  if (!userId || !userRole) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing user identity. Required: X-Nomad-User-Id, X-Nomad-User-Role',
    });
    return;
  }

  // Validate agency
  const agencies = getRegisteredAgencies();
  const agency = agencies.get(agencyId.toLowerCase());

  if (!agency) {
    console.warn(`[ACN Auth] Unknown agency: ${agencyId}`);
    res.status(401).json({
      error: 'Unauthorized',
      message: `Agency '${agencyId}' is not registered with Nomad`,
    });
    return;
  }

  if (agency.key !== agencyKey) {
    console.warn(`[ACN Auth] Invalid key for agency: ${agencyId}`);
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid agency credentials',
    });
    return;
  }

  // Validate role
  const normalizedRole = userRole.toLowerCase() as NomadRole;
  if (!VALID_ROLES.includes(normalizedRole)) {
    res.status(400).json({
      error: 'Bad Request',
      message: `Invalid role '${userRole}'. Valid roles: ${VALID_ROLES.join(', ')}`,
    });
    return;
  }

  // Populate request context
  req.acn = {
    agency: {
      id: agency.id,
      keyPrefix: agencyKey.substring(0, 4) + '****', // For logging only
    },
    user: {
      id: userId,
      name: userName,
      role: normalizedRole,
    },
  };

  // Audit log
  console.log(
    `[ACN Auth] ${agency.id}:${userId} (${normalizedRole}) - ${req.method} ${req.path}`
  );

  next();
}

/**
 * Role-based authorization middleware factory.
 *
 * Creates middleware that checks if the user has one of the required roles.
 *
 * @param allowedRoles - Roles that can access this route
 * @returns Express middleware
 *
 * @example
 * ```typescript
 * // Only FBANs and admins can execute models
 * router.post('/models/:id/execute', requireRoles('admin', 'fban'), executeModel);
 *
 * // Anyone authenticated can list models
 * router.get('/models', requireRoles('admin', 'fban', 'modeler', 'user'), listModels);
 * ```
 */
export function requireRoles(...allowedRoles: NomadRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // In SAN mode, skip role check (handled by simpleAuth)
    if (process.env.NOMAD_DEPLOYMENT_MODE !== 'ACN') {
      return next();
    }

    if (!req.acn) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!allowedRoles.includes(req.acn.user.role)) {
      console.warn(
        `[ACN Auth] Access denied: ${req.acn.agency.id}:${req.acn.user.id} ` +
          `role=${req.acn.user.role} required=${allowedRoles.join('|')}`
      );
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of these roles: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Safely extracts a header value as string.
 */
function getHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0].trim() || undefined;
  }
  return undefined;
}
