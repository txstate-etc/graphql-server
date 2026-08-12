import { filterSchema } from '@graphql-tools/utils'
import {
  execute,
  getArgumentValues,
  getNamedType,
  isInterfaceType,
  isObjectType,
  isUnionType,
  Kind,
  OperationTypeNode,
  type DocumentNode,
  type ExecutionResult,
  type FragmentDefinitionNode,
  type GraphQLInterfaceType,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  type GraphQLUnionType,
  type OperationDefinitionNode,
  type SelectionSetNode
} from 'graphql'
import { Cache } from 'txstate-utils'
import { ScopeError } from './errors.ts'
import { shasum } from './util.ts'

export interface ClientScopeOptions<AuthType = unknown, ScopeData = unknown> {
  /**
   * Scope a client application's access to a subset of the GraphQL surface. Called once
   * per (typeName, fieldName) reference in a query — at request time as part of a one-shot
   * AST analysis before any resolver runs, and at introspection time to build a filtered
   * schema. Returning anything other than `true` at request time aborts the whole request
   * with 400 (no partial data). Returning anything other than `true` for introspection
   * hides the field from the schema the client sees.
   *
   * The function receives a single object with:
   * - `auth` — the per-request auth object, populated by fastify-txstate
   * - `typeName` — parent type name (e.g. `'Query'`, `'Book'`, `'Person'`)
   * - `fieldName` — field name on that type (e.g. `'author'`, `'name'`)
   * - `args` — resolved field arguments (variables substituted), or `undefined` during introspection filtering
   * - `isIntrospection` — `true` when called to build the introspection schema for this client
   * - `scopeData` — whatever `loadScopeData` resolved for this client. Typed by the `ScopeData`
   *   generic on `start()` / `GQLStartOpts` (defaults to `unknown`).
   *
   * Return `true` to allow, `false` to deny with the default message, or a `string` to deny
   * with a human-readable reason that will be appended to the 400 error message. For
   * introspection (`isIntrospection: true`), any non-`true` return hides the field; the
   * reason string is ignored.
   *
   * Intentionally synchronous and expected to be fast: the analyzer calls this once per
   * `(typeName, fieldName)` reference in the query before any resolver runs. Keep it
   * O(1) — typically a `Set.has` lookup against data prepared in `loadScopeData`. Any
   * async lookups belong in `loadScopeData`.
   *
   * The filtered introspection response is cached per (`clientId`, query, variables) for
   * the txstate-utils `Cache` defaults (5 min fresh / 10 min stale). Runtime scope checks
   * are not cached — they're cheap enough to rerun on every request, and skipping the
   * cache keeps scope changes visible within the 30s `loadScopeData` window.
   */
  fieldIsInScope?: (params: {
    auth: AuthType
    typeName: string
    fieldName: string
    args: Record<string, unknown> | undefined
    isIntrospection: boolean
    scopeData: ScopeData
  }) => boolean | string
  /**
   * Block whole types regardless of which field a client used to reach them. Called only
   * for object, interface, and union types — the types a query can select fields on —
   * as they are referenced in a query (return types, fragment type conditions) and during
   * introspection filtering. Scalars, enums, and input types are never sent to you (govern
   * them through the fields and args that use them), and root types (`Query`, `Mutation`,
   * `Subscription`) are always treated as in scope.
   *
   * Return shape matches `fieldIsInScope`:
   * - `true` — allow this type
   * - `false` — deny with the default message
   * - `string` — deny with that string appended to the 400 error (ignored during introspection)
   *
   * Reach for this when "this client can never see anything of type `PersonalData`,
   * no matter what field returns it" is simpler than enumerating every field that
   * exposes the type. If only `fieldIsInScope` is set, type-level rules don't apply.
   */
  typeIsInScope?: (params: {
    auth: AuthType
    typeName: string
    isIntrospection: boolean
    scopeData: ScopeData
  }) => boolean | string
  /**
   * Load the scope data your `fieldIsInScope` needs (e.g. the client's allowed-field set
   * from a database). Receives the request's `clientId` (or `undefined` if the request
   * has none) and returns whatever shape your `fieldIsInScope` expects.
   *
   * The library wraps this in a txstate-utils `Cache` keyed by `clientId` with a short
   * 30-second fresh window (60-second stale), so the underlying lookup runs at most
   * twice per minute per client even under heavy load. The cached value is assigned to
   * `ctx.scopeData` on every request, so resolvers can read it directly without a
   * second fetch. The short window keeps scope changes visible quickly; if your
   * lookup is expensive enough that 30s isn't aggressive enough, add your own longer
   * cache inside this function with whatever invalidation strategy fits.
   *
   * The signature is intentionally narrow — scope is per-client by design, so we don't
   * pass the full auth object. Per-user authorization belongs in resolver logic.
   *
   * Return type matches the `ScopeData` generic on `start()` / `GQLStartOpts` (defaults
   * to `unknown`). Pass it explicitly (`server.start<MyScope>({...})`) or let TypeScript
   * infer it from this function's return type or from `fieldIsInScope`'s `scopeData` param.
   */
  loadScopeData?: (clientId: string | undefined) => Promise<ScopeData>
}

/**
 * The scope data shape that `defaultClientScope` understands.
 *
 * ```typescript
 * // whitelist client: books with all their fields, people limited to id and name
 * {
 *   allowed: new Map([
 *     ['Query', new Set(['books', 'people'])],
 *     ['Book', new Set<string>()],
 *     ['Person', new Set(['id', 'name'])]
 *   ]),
 *   disallowed: new Map()
 * }
 *
 * // blacklist client: everything except people's contact info
 * { allowed: new Map(), disallowed: new Map([['Person', new Set(['contact'])]]) }
 *
 * // ban the whole Person type, no matter which field returns it
 * { allowed: new Map(), disallowed: new Map([['Person', new Set<string>()]]) }
 *
 * // unrestricted client: two empty maps
 * { allowed: new Map(), disallowed: new Map() }
 * ```
 *
 * Two empty maps mean an unrestricted client, but `loadScopeData` returning `undefined`
 * (client not found) denies everything — emptying a client's grants lifts the whitelist
 * rather than revoking access. Revoke by deleting the client's scope row, or better, by
 * no longer trusting its clientId during authentication.
 */
export interface DefaultScopeData {
  /** keyed by type name; an empty set allows every field of the type, an empty map imposes no whitelist at all */
  allowed: Map<string, Set<string>>
  /** keyed by type name; an empty set bans the whole type; always wins over `allowed` */
  disallowed: Map<string, Set<string>>
}

function isDefaultScopeData (scopeData: unknown): scopeData is DefaultScopeData {
  return scopeData != null && (scopeData as DefaultScopeData).allowed instanceof Map && (scopeData as DefaultScopeData).disallowed instanceof Map
}

function defaultFieldIsInScope ({ typeName, fieldName, scopeData }: { typeName: string, fieldName: string, scopeData: unknown }): boolean {
  if (!isDefaultScopeData(scopeData)) return false
  const banned = scopeData.disallowed.get(typeName)
  if (banned != null && (!(banned instanceof Set) || banned.size === 0 || banned.has(fieldName))) return false
  if (scopeData.allowed.size === 0) return true
  const granted = scopeData.allowed.get(typeName)
  if (!(granted instanceof Set)) return false
  return granted.size === 0 || granted.has(fieldName)
}

// only ever called with object, interface, and union types, so it can enforce the
// whitelist as well as whole-type bans: a whitelist client must list every composite
// type it touches.
function defaultTypeIsInScope ({ typeName, scopeData }: { typeName: string, scopeData: unknown }): boolean {
  if (!isDefaultScopeData(scopeData)) return false
  const banned = scopeData.disallowed.get(typeName)
  if (banned != null && !(banned instanceof Set && banned.size > 0)) return false
  return scopeData.allowed.size === 0 || scopeData.allowed.has(typeName)
}

/**
 * Ready-made scope enforcement for the common case where scope is a per-client map of
 * allowed and disallowed fields. Spread it into your start options alongside a
 * `loadScopeData` that returns `DefaultScopeData` — see that interface for the semantics
 * and some example scopes.
 *
 * ```typescript
 * await server.start<DefaultScopeData>({
 *   resolvers: [...],
 *   loadScopeData: async (clientId) => await db.getScopeForClient(clientId),
 *   ...defaultClientScope
 * })
 * ```
 *
 * It's one implementation packaged as one export: the field check does nearly all of the
 * enforcement, while the type check covers what a per-field check can't see — a
 * `{ people { __typename } }` selection that would reveal how many objects of a banned
 * or unlisted type exist, and introspection filtering that must drop such a type along
 * with every field that returns it.
 *
 * Scope data that is missing or doesn't match the shape denies everything. Failing closed
 * means a typo like `allow` instead of `allowed` breaks your first test query instead of
 * silently opening the whole API.
 */
export const defaultClientScope = {
  fieldIsInScope: defaultFieldIsInScope,
  typeIsInScope: defaultTypeIsInScope
}

interface IntrospectionContext<AuthType, ScopeData> {
  auth: AuthType
  scopeData: ScopeData
  parsedQuery: DocumentNode
  variables: Record<string, unknown> | undefined
  operationName: string | undefined
  ctx: unknown
}

export function isIntrospectionOperation (parsedQuery: DocumentNode, operationName: string | undefined): boolean {
  const op = parsedQuery.definitions.find((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION && (operationName == null || d.name?.value === operationName))
  if (!op) return false
  return op.selectionSet.selections.some(s => s.kind === Kind.FIELD && (s.name.value === '__schema' || s.name.value === '__type'))
}

export class ClientScope<AuthType = unknown, ScopeData = unknown> {
  private readonly schema: GraphQLSchema
  private readonly fieldIsInScope: ClientScopeOptions<AuthType, ScopeData>['fieldIsInScope']
  private readonly typeIsInScope: ClientScopeOptions<AuthType, ScopeData>['typeIsInScope']
  private readonly rootTypeNames: Set<string>
  private readonly scopeDataCache?: Cache<string, ScopeData>
  private readonly introspectionCache?: Cache<string, ExecutionResult, IntrospectionContext<AuthType, ScopeData>>
  readonly enabled: boolean

  constructor (schema: GraphQLSchema, options: ClientScopeOptions<AuthType, ScopeData>) {
    this.schema = schema
    this.fieldIsInScope = options.fieldIsInScope
    this.typeIsInScope = options.typeIsInScope
    this.enabled = this.fieldIsInScope != null || this.typeIsInScope != null
    this.rootTypeNames = new Set<string>([schema.getQueryType()?.name, schema.getMutationType()?.name, schema.getSubscriptionType()?.name].filter((n): n is string => n != null))
    const loadScopeData = options.loadScopeData
    this.scopeDataCache = loadScopeData
      ? new Cache(async (clientId: string) => await loadScopeData(clientId === '' ? undefined : clientId), { freshseconds: 30 })
      : undefined
    this.introspectionCache = this.enabled
      ? new Cache<string, ExecutionResult, IntrospectionContext<AuthType, ScopeData>>(async (_key, helper) => await this.buildAndExecuteIntrospection(helper))
      : undefined
  }

  async loadScopeData (clientId: string | undefined): Promise<ScopeData> {
    if (!this.scopeDataCache) return undefined as ScopeData
    return await this.scopeDataCache.get(clientId ?? '')
  }

  analyze (parsedQuery: DocumentNode, operationName: string | undefined, variables: Record<string, unknown> | undefined, auth: AuthType, scopeData: ScopeData): ScopeError | undefined {
    if (!this.enabled) return undefined
    const operation = parsedQuery.definitions.find((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION && (operationName == null || d.name?.value === operationName))
    if (!operation) return undefined
    const rootType = operation.operation === OperationTypeNode.QUERY ? this.schema.getQueryType() : operation.operation === OperationTypeNode.MUTATION ? this.schema.getMutationType() : this.schema.getSubscriptionType()
    if (!rootType) return undefined
    const fragments = new Map<string, FragmentDefinitionNode>()
    for (const def of parsedQuery.definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def)
    }
    const checkType = (typeName: string): ScopeError | undefined => {
      if (!this.typeIsInScope || this.rootTypeNames.has(typeName)) return undefined
      const result = this.typeIsInScope({ auth, typeName, isIntrospection: false, scopeData })
      if (result !== true) return new ScopeError(typeName, undefined, typeof result === 'string' ? result : undefined)
      return undefined
    }
    const walk = (parentType: GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType, selectionSet: SelectionSetNode): ScopeError | undefined => {
      for (const sel of selectionSet.selections) {
        if (sel.kind === Kind.FIELD) {
          const fieldName = sel.name.value
          if (fieldName.startsWith('__')) continue
          if (!isObjectType(parentType) && !isInterfaceType(parentType)) continue
          const fieldDef = parentType.getFields()[fieldName]
          let args: Record<string, unknown> = {}
          try {
            args = getArgumentValues(fieldDef, sel, variables)
          } catch { /* let execute() surface the proper error */ }
          const fieldType = getNamedType(fieldDef.type)
          if (isObjectType(fieldType) || isInterfaceType(fieldType) || isUnionType(fieldType)) {
            const typeErr = checkType(fieldType.name)
            if (typeErr) return typeErr
          }
          if (this.fieldIsInScope) {
            const result = this.fieldIsInScope({ auth, typeName: parentType.name, fieldName, args, isIntrospection: false, scopeData })
            if (result !== true) return new ScopeError(parentType.name, fieldName, typeof result === 'string' ? result : undefined)
          }
          if (sel.selectionSet) {
            if (isObjectType(fieldType) || isInterfaceType(fieldType) || isUnionType(fieldType)) {
              const err = walk(fieldType, sel.selectionSet)
              if (err) return err
            }
          }
        } else if (sel.kind === Kind.INLINE_FRAGMENT) {
          const condType = sel.typeCondition ? this.schema.getType(sel.typeCondition.name.value) : parentType
          if (condType && (isObjectType(condType) || isInterfaceType(condType) || isUnionType(condType))) {
            const typeErr = checkType(condType.name)
            if (typeErr) return typeErr
            const err = walk(condType, sel.selectionSet)
            if (err) return err
          }
        } else {
          const frag = fragments.get(sel.name.value)
          if (frag) {
            const condType = this.schema.getType(frag.typeCondition.name.value)
            if (condType && (isObjectType(condType) || isInterfaceType(condType) || isUnionType(condType))) {
              const typeErr = checkType(condType.name)
              if (typeErr) return typeErr
              const err = walk(condType, frag.selectionSet)
              if (err) return err
            }
          }
        }
      }
      return undefined
    }
    return walk(rootType, operation.selectionSet)
  }

  async runIntrospection (opts: {
    query: string
    parsedQuery: DocumentNode
    operationName: string | undefined
    variables: Record<string, unknown> | undefined
    auth: AuthType
    scopeData: ScopeData
    ctx: unknown
    clientId: string | undefined
  }): Promise<ExecutionResult> {
    const helper: IntrospectionContext<AuthType, ScopeData> = {
      auth: opts.auth,
      scopeData: opts.scopeData,
      parsedQuery: opts.parsedQuery,
      variables: opts.variables,
      operationName: opts.operationName,
      ctx: opts.ctx
    }
    if (!this.introspectionCache || opts.clientId == null) return await this.buildAndExecuteIntrospection(helper)
    return await this.introspectionCache.get(`${opts.clientId}:${shasum(opts.query + '|' + JSON.stringify(opts.variables ?? {}))}`, helper)
  }

  private async buildAndExecuteIntrospection (h: IntrospectionContext<AuthType, ScopeData>): Promise<ExecutionResult> {
    const allowType = (typeName: string) => this.rootTypeNames.has(typeName) || !this.typeIsInScope || this.typeIsInScope({ auth: h.auth, typeName, isIntrospection: true, scopeData: h.scopeData }) === true
    const allowField = (typeName: string, fieldName: string, fieldConfig: { type: GraphQLType }) => {
      if (this.typeIsInScope) {
        const returnType = getNamedType(fieldConfig.type)
        if ((isObjectType(returnType) || isInterfaceType(returnType) || isUnionType(returnType)) && !allowType(returnType.name)) return false
      }
      if (this.fieldIsInScope && this.fieldIsInScope({ auth: h.auth, typeName, fieldName, args: undefined, isIntrospection: true, scopeData: h.scopeData }) !== true) return false
      return true
    }
    const filteredSchema = filterSchema({
      schema: this.schema,
      typeFilter: (typeName, type) => (!isObjectType(type) && !isInterfaceType(type) && !isUnionType(type)) || allowType(typeName),
      objectFieldFilter: allowField,
      interfaceFieldFilter: allowField,
      rootFieldFilter: (operation, fieldName, fieldConfig) => allowField(operation, fieldName, fieldConfig)
    })
    return await execute({ schema: filteredSchema, document: h.parsedQuery, contextValue: h.ctx, variableValues: h.variables, operationName: h.operationName })
  }
}
