/**
 * Local persistence shapes for SCP Hub additions: one SCP server entry and
 * one installed skill entry, both read-only facts captured from the catalog.
 *
 * @module dsh-plugin-inkstone/scphub/types
 */

/** One locally added SCP server. */
export interface LocalScp {
  /** Catalog server id. */
  readonly id: string
  /** Display name from the catalog. */
  readonly name: string
  /** Catalog description. */
  readonly description: string
  /** Publisher label. */
  readonly publisher: string
  /** The MCP endpoint the server publishes. */
  readonly endpoint: string
  /** Whether the server's tools mount into the tool registry. */
  readonly enabled: boolean
  /** Tool name inventory at add time; diagnostic only. */
  readonly toolNames: readonly string[]
}

/** One locally installed skill. */
export interface LocalSkill {
  /** Catalog skill id. */
  readonly id: string
  /** Kebab-case skill name used for `ctx.skills` registration. */
  readonly skillName: string
  /** Display name from the catalog. */
  readonly name: string
  /** Catalog description; doubles as the skill routing description. */
  readonly description: string
  /** Whether the skill registers into `ctx.skills`. */
  readonly enabled: boolean
}
