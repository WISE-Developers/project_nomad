/**
 * The context MCP tools act within.
 *
 * Carries the identity everything MCP creates is attributed to. Threaded as a
 * parameter rather than held in module state: module state is set once and read
 * everywhere, so a tool registered before it is populated reads `undefined` and writes
 * an unowned row — a failure that depends on import order and leaves no trace at the
 * call site. A parameter makes the dependency visible to the type checker instead.
 *
 * Optional, because a server built without a context is legitimate — that is the shape
 * existing tests construct, and the shape that writes no owner. A configured MCP
 * endpoint always has one; that is settled at startup in `auth.ts` and `identity.ts`
 * rather than here.
 */
export interface McpToolContext {
  /**
   * Stored as `FireModel.userId` on everything MCP creates.
   *
   * Matches what `resolveUserId` writes on the HTTP path, so MCP-created models are
   * owned in the same terms as the rest of the system rather than in a parallel
   * namespace: in oauth mode that is the account email.
   */
  readonly userId: string;
}
