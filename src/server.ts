import path from 'node:path'
import { type FastifyRequest, type FastifyReply } from 'fastify'
import Server, { devLogger, type FastifyTxStateOptions, HttpError, prodLogger } from 'fastify-txstate'
import { readFile } from 'fs/promises'
import { execute, type GraphQLError, lexicographicSortSchema, parse, specifiedRules, validate } from 'graphql'
import { LRUCache } from 'lru-cache'
import { Cache, toArray } from 'txstate-utils'
import { buildSchema, type BuildSchemaOptions } from 'type-graphql'
import { composeQueryDigest, QueryDigest } from './querydigest'
import { Context, MockContext } from './context'
import { ExecutionError, ParseError, AuthError } from './errors'
import { buildFederationSchema } from './federation'
import { NoIntrospection, shasum } from './util'

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

export interface GQLStartOpts <CustomContext extends typeof MockContext = typeof Context> extends BuildSchemaOptions {
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
  after?: (queryTime: number, operationName: string, query: string, auth: any, variables: any, data: any, errors: GraphQLError[] | undefined) => void | Promise<void>
  send403?: (ctx: InstanceType<CustomContext>) => boolean | Promise<boolean>
}

export interface GQLRequest { Body: { operationName: string, query: string, variables?: object, extensions?: { persistedQuery?: { version: number, sha256Hash: string }, querySignature: string } } }

export const gqlDevLogger = {
  ...devLogger,
  info: (msg: any) => {
    if (msg.res) {
      console.info(`${Math.round(msg.responseTime)}ms ${msg.res.extraLogInfo?.query?.replace(/[\s]+/g, ' ') ?? `${msg.res.statusCode} ${msg.res.request?.method ?? ''} ${msg.res.request?.url ?? ''}`}`)
    } else if (!msg.req) {
      console.info(msg)
    }
  }
}
const authErrorRegex = /authentication/i
async function doNothing () {}
export class GQLServer extends Server {
  constructor (config?: FastifyTxStateOptions) {
    super({
      logger: (process.env.NODE_ENV !== 'development'
        ? prodLogger
        : gqlDevLogger),
      ...config
    })
  }

  public async start (options?: number | GQLStartOpts) {
    if (typeof options === 'number' || !options?.resolvers?.length) throw new Error('Must start graphql server with some resolvers.')
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
        res = res.type('text/html')
        const pg = (await readFile(path.join(__dirname, 'playground.html'))).toString('utf-8')
        return pg
          .replace(/GRAPHQL_ENDPOINT/, (process.env.API_PREFIX ?? '') + options.gqlEndpoint![0])
          .replace(/GRAPHQL_SETTINGS/, JSON.stringify(options.playgroundSettings))
          .replace(/API_PREFIX/, process.env.API_PREFIX ?? '')
      })
      this.app.get('/playground.js', async (req, res) => {
        res = res.type('text/javascript')
        const pg = (await readFile(path.join(__dirname, 'playground.js'))).toString('utf-8')
        return pg
      })
    }
    if (options.voyagerEndpoint !== false && process.env.GRAPHQL_VOYAGER !== 'false') {
      this.app.get(options.voyagerEndpoint ?? '/voyager', async (req, res) => {
        res = res.type('text/html')
        const pg = (await readFile(path.join(__dirname, 'voyager.html'))).toString('utf-8')
        return options.gqlEndpoint ? pg.replace(/GRAPHQL_ENDPOINT/, (process.env.API_PREFIX ?? '') + options.gqlEndpoint[0]) : pg
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
    ContextClass.init()
    if (options.requireSignedQueries) {
      QueryDigest.init()
    }

    (MockContext as any).executeQuery = async (ctx: MockContext, query: string, variables?: any, operationName?: string) => {
      const parsedQuery = await parsedQueryCache.get(query)
      if (parsedQuery instanceof ParseError) throw new Error(parsedQuery.toString())
      operationName ??= (parsedQuery.definitions.find((def) => def.kind === 'OperationDefinition'))?.name?.value
      return await execute(schema, parsedQuery, {}, ctx, variables, operationName)
    }

    const handlePost = async (req: FastifyRequest<GQLRequest>, res: FastifyReply) => {
      try {
        const ctx = new ContextClass(req)
        await ctx.waitForAuth()
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        if ((options.send401 || options.requireSignedQueries) && ctx.auth == null) {
          throw new HttpError(401, 'all graphql requests require authentication, including introspection')
        }
        if (options.send403 && await options.send403(ctx)) {
          throw new HttpError(403, 'Not authorized to use this service.')
        }

        let body: GQLRequest['Body']
        if (req.isMultipart?.()) {
          const parts = req.parts()
          const { value, done } = await parts.next()
          const json = value.value
          body = JSON.parse(json)
          if (!done) ctx.setParts(parts)
        } else {
          body = req.body
        }

        let query: string | undefined = body.query
        if (options.requireSignedQueries) {
          if (ctx.auth?.client_id == null) {
            throw new HttpError(401, 'request requires authentication with client service')
          } else if (!(options.signedQueriesWhitelist?.has(ctx.auth.client_id))) {
            const qd = new QueryDigest(req)
            if (qd.jwtToken == null) throw new HttpError(400, 'request requires signed query digest')
            if (!persistedVerifiedQueryDigestCache.get(qd.jwtToken + query)) {
              const digest = await qd.getVerifiedDigest()
              if (digest == null) throw new HttpError(400, 'request contains a missing or invalid query digest')
              if (digest !== composeQueryDigest(ctx.auth.client_id, query)) throw new HttpError(400, 'request contains a mismatched client service or query')
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
            query = persistedQueryCache.get(hash)
            if (!query) {
              return { errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }] }
            }
          }
        }
        const parsedQuery = await parsedQueryCache.get(query)
        if (parsedQuery instanceof ParseError) {
          req.log.error(parsedQuery.toString())
          return { errors: parsedQuery.errors }
        }
        const operationName: string | undefined = body.operationName ?? (parsedQuery.definitions.find((def) => def.kind === 'OperationDefinition'))?.name?.value
        req.log.info({ operationName, query, auth: ctx.auth }, 'finished parsing query')
        const start = new Date()
        const ret = await execute(schema, parsedQuery, {}, ctx, body.variables, operationName)
        if (ret?.errors?.length) {
          if (ret.errors.some(e => authErrorRegex.test(e.message))) throw new AuthError()
          req.log.error(new ExecutionError(query, ret.errors).toString())
        }
        if (operationName !== 'IntrospectionQuery') {
          const queryTime = new Date().getTime() - start.getTime()
          options.after!(queryTime, operationName, query, ctx.auth, body.variables, ret.data, ret.errors as GraphQLError[])?.catch(e => { res.log.error(e) })
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
