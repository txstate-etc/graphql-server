import path from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { Multipart } from '@fastify/multipart'
import type { FastifyRequest, FastifyReply } from 'fastify'
import Server, { type FastifyTxStateOptions, HttpError, prodLogger } from 'fastify-txstate'
import { readFile } from 'node:fs/promises'
import { execute, type GraphQLError, type GraphQLSchema, type DefinitionNode, type OperationDefinitionNode, Kind, lexicographicSortSchema, parse, specifiedRules, validate } from 'graphql'
import { LRUCache } from 'lru-cache'
import pino from 'pino'
import { Cache, toArray } from 'txstate-utils'
import { buildSchema, type BuildSchemaOptions } from 'type-graphql'
import { composeQueryDigest, QueryDigest } from './querydigest.ts'
import { Context, MockContext } from './context.ts'
import { ExecutionError, ParseError, AuthError } from './errors.ts'
import { buildFederationSchema } from './federation.ts'
import { NoIntrospection, shasum } from './util.ts'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

interface PlaygroundSettings {
  'general.betaUpdates'?: boolean
  'editor.cursorShape'?: 'line' | 'block' | 'underline'
  'editor.theme'?: 'dark' | 'light'
  'editor.reuseHeaders'?: boolean
  'tracing.hideTracingResponse'?: boolean
  'tracing.tracingSupported'?: boolean
  'editor.fontSize'?: number
  'editor.fontFamily'?: string
  'request.credentials'?: string
  'request.globalHeaders'?: Record<string, string>
  'schema.polling.enable'?: boolean
  'schema.polling.endpointFilter'?: string
  'schema.polling.interval'?: number
}

export interface GQLStartOpts<CustomContext extends typeof Context = typeof Context> extends BuildSchemaOptions {
  port?: number
  gqlEndpoint?: string | string[]
  playgroundEndpoint?: string | false
  playgroundSettings?: PlaygroundSettings
  voyagerEndpoint?: string | false
  customContext?: CustomContext
  send401?: boolean
  federated?: boolean
  introspection?: boolean
  requireSignedQueries?: boolean
  signedQueriesWhitelist?: Set<string>
  after?: (queryTime: number, operationName: string | undefined, query: string, auth: any, variables: any, data: any, errors: GraphQLError[] | undefined, ctx: InstanceType<CustomContext>) => void | Promise<void>
  send403?: (ctx: InstanceType<CustomContext>) => boolean | Promise<boolean>
  /**
   * Run any async tasks that require the schema to be fully built, but need to complete before the
   * server begins accepting requests. In DosGato CMS this is used to populate test data, which requires
   * MockContext.executeQuery to be up and running because template validation functions execute queries
   * against the schema.
   *
   * Will be given the GraphQLSchema as an argument.
   */
  beforeStartup?: (schema: GraphQLSchema) => Promise<void>
}

export interface GQLRequest { Body: { operationName?: string, query: string, variables?: Record<string, unknown>, extensions?: { persistedQuery?: { version: number, sha256Hash: string }, querySignature: string } } }

interface PinoLogChunk {
  res?: {
    extraLogInfo?: { query?: string }
    statusCode?: number
    request?: { method?: string, url?: string }
  }
  err?: unknown
  req?: unknown
  msg?: string
  responseTime?: number
}

export const gqlDevLogger = pino({ level: 'info' }, new Writable({
  write (chunk, _encoding, callback) {
    const obj = JSON.parse(String(chunk)) as PinoLogChunk
    if (obj.res) {
      const formatted = obj.res.extraLogInfo?.query?.replace(/[\s]+/gv, ' ') ?? `${obj.res.statusCode} ${obj.res.request?.method ?? ''} ${obj.res.request?.url ?? ''}`
      // eslint-disable-next-line no-console -- dev logger output
      console.info(`${Math.round(obj.responseTime ?? 0)}ms ${formatted}`)
    } else if (obj.err) {
      // eslint-disable-next-line no-console -- dev logger output
      console.error(obj.err)
    } else if (!obj.req) {
      // eslint-disable-next-line no-console -- dev logger output
      console.info(obj.msg ?? obj)
    }
    callback()
  }
}))
const authErrorRegex = /authentication/iv
const doNothing = async () => { /* default options.after */ }
export class GQLServer extends Server {
  constructor (config?: FastifyTxStateOptions) {
    super({
      loggerInstance: (process.env.NODE_ENV !== 'development'
        ? prodLogger
        : gqlDevLogger),
      ...config
    })
  }

  public async start (options?: number | GQLStartOpts) {
    if (typeof options === 'number' || !options?.resolvers.length) throw new Error('Must start graphql server with some resolvers.')
    options.gqlEndpoint ??= '/graphql'
    options.gqlEndpoint = toArray(options.gqlEndpoint)
    options.playgroundSettings ??= {}
    options.playgroundSettings['schema.polling.enable'] ??= false
    options.after ??= doNothing
    options.introspection ??= true
    options.requireSignedQueries ??= false
    options.signedQueriesWhitelist ??= new Set<string>()

    const ContextClass = options.customContext ?? Context

    if (options.playgroundEndpoint !== false && process.env.GRAPHQL_PLAYGROUND !== 'false') {
      this.app.get(options.playgroundEndpoint ?? '/', async (req, res) => {
        res.type('text/html')
        const pg = (await readFile(path.join(moduleDir, 'playground.html'))).toString('utf-8')
        return pg
          .replace(/GRAPHQL_ENDPOINT/v, (process.env.API_PREFIX ?? '') + options.gqlEndpoint![0])
          .replace(/GRAPHQL_SETTINGS/v, JSON.stringify(options.playgroundSettings))
          .replace(/API_PREFIX/v, process.env.API_PREFIX ?? '')
      })
      this.app.get('/playground.js', async (req, res) => {
        res.type('text/javascript')
        const pg = (await readFile(path.join(moduleDir, 'playground.js'))).toString('utf-8')
        return pg
      })
    }
    if (options.voyagerEndpoint !== false && process.env.GRAPHQL_VOYAGER !== 'false') {
      this.app.get(options.voyagerEndpoint ?? '/voyager', async (req, res) => {
        res.type('text/html')
        const pg = (await readFile(path.join(moduleDir, 'voyager.html'))).toString('utf-8')
        return options.gqlEndpoint ? pg.replace(/GRAPHQL_ENDPOINT/v, (process.env.API_PREFIX ?? '') + options.gqlEndpoint[0]) : pg
      })
    }

    let schema = lexicographicSortSchema(await buildSchema({
      ...options,
      validate: false
    }))
    if (options.federated) {
      schema = buildFederationSchema(schema)
    }
    const validateRules = [...specifiedRules, ...(options.introspection && process.env.GRAPHQL_INTROSPECTION !== 'false' ? [] : [NoIntrospection])]
    const parsedQueryCache = new Cache(async (query: string) => {
      const parsedQuery = parse(query)
      const errors = validate(schema, parsedQuery, validateRules)
      if (errors.length) return new ParseError(query, errors)
      return parsedQuery
    }, {
      freshseconds: 3600,
      staleseconds: 7200
    })
    const persistedQueryCache = new LRUCache<string, string>({
      maxSize: 1024 * 1024,
      sizeCalculation: (entry: string, key: string) => entry.length + key.length
    })
    const persistedVerifiedQueryDigestCache = new LRUCache<string, boolean>({
      maxSize: 1024 * 1024 * 2,
      sizeCalculation: (entry: boolean, key: string) => key.length + 1
    })
    if (options.requireSignedQueries) {
      QueryDigest.init()
    }

    type ExecuteQueryFn = (ctx: MockContext, query: string, variables?: Record<string, unknown>, operationName?: string) => Promise<unknown>
    ;(MockContext as unknown as { executeQuery: ExecuteQueryFn }).executeQuery = async (ctx, query, variables, operationName) => {
      const parsedQuery = await parsedQueryCache.get(query)
      if (parsedQuery instanceof ParseError) throw new Error(parsedQuery.toString())
      operationName ??= parsedQuery.definitions.find((def: DefinitionNode): def is OperationDefinitionNode => def.kind === Kind.OPERATION_DEFINITION)?.name?.value
      return await execute({ schema, document: parsedQuery, contextValue: ctx, variableValues: variables, operationName })
    }

    await options.beforeStartup?.(schema)

    const handlePost = async (req: FastifyRequest<GQLRequest>, res: FastifyReply) => {
      try {
        const ctx = new ContextClass(req)

        if ((options.send401 || options.requireSignedQueries) && ctx.auth == null) {
          throw new HttpError(401, 'all graphql requests require authentication, including introspection')
        }
        await ctx.prefetch()
        if (options.send403 && await options.send403(ctx)) {
          throw new HttpError(403, 'Not authorized to use this service.')
        }

        let body: GQLRequest['Body']
        if (typeof req.isMultipart === 'function' && req.isMultipart()) {
          const parts = req.parts()
          const next = await parts.next()
          const part = next.value as Multipart | undefined
          if (part?.type !== 'field' || typeof part.value !== 'string') {
            throw new HttpError(400, 'first multipart segment must be a JSON-encoded GraphQL request')
          }
          body = JSON.parse(part.value) as GQLRequest['Body']
          if (!next.done) ctx.setParts(parts)
        } else {
          body = req.body
        }

        let query: string = body.query
        if (options.requireSignedQueries) {
          if (ctx.auth?.clientId == null) {
            throw new HttpError(401, 'request requires authentication with client service')
          } else if (!options.signedQueriesWhitelist!.has(ctx.auth.clientId)) {
            const qd = new QueryDigest(req)
            if (qd.jwtToken == null) throw new HttpError(400, 'request requires signed query digest')
            if (!persistedVerifiedQueryDigestCache.get(qd.jwtToken + query)) {
              const digest = await qd.getVerifiedDigest()
              if (digest == null) throw new HttpError(400, 'request contains a missing or invalid query digest')
              if (digest !== composeQueryDigest(ctx.auth.clientId, query)) throw new HttpError(400, 'request contains a mismatched client service or query')
              persistedVerifiedQueryDigestCache.set(qd.jwtToken + query, true)
            }
          }
        }
        const hash = body.extensions?.persistedQuery?.sha256Hash
        if (hash) {
          if (query) {
            if (hash !== shasum(query)) throw new HttpError(401, 'provided sha does not match query')
            persistedQueryCache.set(hash, query)
          } else {
            const cached = persistedQueryCache.get(hash)
            if (!cached) {
              return { errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }] }
            }
            query = cached
          }
        }
        const parsedQuery = await parsedQueryCache.get(query)
        if (parsedQuery instanceof ParseError) {
          req.log.error(parsedQuery.toString())
          return { errors: parsedQuery.errors }
        }
        const operationName: string | undefined = body.operationName ?? parsedQuery.definitions.find((def: DefinitionNode): def is OperationDefinitionNode => def.kind === Kind.OPERATION_DEFINITION)?.name?.value
        req.log.info({ operationName, query, auth: ctx.authForLog() }, 'finished parsing query')
        const start = new Date()
        const ret = await execute({ schema, document: parsedQuery, contextValue: ctx, variableValues: body.variables, operationName })
        if (ret.errors?.length) {
          if (ret.errors.some(e => authErrorRegex.test(e.message))) throw new AuthError()
          req.log.error(new ExecutionError(query, ret.errors).toString())
        }
        await ctx.drainFiles()
        if (operationName !== 'IntrospectionQuery') {
          const queryTime = new Date().getTime() - start.getTime()
          const afterResult = options.after!(queryTime, operationName, query, ctx.auth, body.variables, ret.data, ret.errors as GraphQLError[], ctx)
          if (afterResult instanceof Promise) afterResult.catch((e: unknown) => { res.log.error(e) })
        }
        return ret
      } catch (e: any) {
        if (e instanceof HttpError) {
          await res.status(e.statusCode).send({ errors: [{ message: e.message, extensions: { authenticationError: e.statusCode === 401 } }] })
        } else {
          throw e
        }
      }
    }

    for (const path of options.gqlEndpoint) {
      this.app.post(path, handlePost)
    }
    await super.start(options.port)
  }
}
