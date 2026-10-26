/**
 * Better Auth Client
 *
 * Client-side auth instance for OAuth social login.
 * Only used when the server reports authMode=oauth (#474).
 */

import { createAuthClient } from 'better-auth/react';

const baseURL = window.location.origin;

export const authClient = createAuthClient({
  baseURL,
});
