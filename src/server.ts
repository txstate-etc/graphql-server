import { FastifyRequest, FastifyReply } from 'fastify'
import Server, { FastifyTxStateOptions, HttpError } from 'fastify-txstate'
import { readFile } from 'fs/promises'
import { execute, lexicographicSortSchema, OperationDefinitionNode, parse, validate } from 'graphql'
import LRU from 'lru-cache'
import path from 'path'
import { Cache, toArray } from 'txstate-utils'
import { buildSchema, BuildSchemaOptions } from 'type-graphql'
import { composeQueryDigest, QueryDigest } from './querydigest'
import { Context, Type } from './context'
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
  'request.globalHeaders'?: { [key: string]: string }
  'schema.polling.enable'?: boolean
  'schema.polling.endpointFilter'?: string
  'schema.polling.interval'?: number
}

export interface GQLStartOpts <CustomContext extends Context = Context> extends BuildSchemaOptions {
  port?: number
  gqlEndpoint?: string|string[]
  playgroundEndpoint?: string|false
  playgroundSettings?: PlaygroundSettings
  voyagerEndpoint?: string|false
  customContext?: Type<CustomContext>
  send401?: boolean
  federated?: boolean
  introspection?: boolean
  requireSignedQueries?: boolean
  signedQueriesWhitelist?: Set<string>
  after?: (queryTime: number, operationName: string, query: string, auth: any, variables: any) => Promise<any>
}

export interface GQLRequest { Body: { operationName: string, query: string, variables?: object, extensions?: { persistedQuery?: { version: number, sha256Hash: string } } } }

class DevLogger {
  info (msg: any) {
    if (msg.res) {
      console.log(`${Math.round(msg.responseTime)}ms ${msg.res.gqlInfo?.query as string ?? ''}`)
    } else if (!msg.req) {
      console.info(msg)
    }
  }

  error (msg: any) { console.error(msg) }
  debug (msg: any) { console.debug(msg) }
  fatal (msg: any) { console.error(msg) }
  warn (msg: any) { console.warn(msg) }
  trace (msg: any) { console.trace(msg) }
  child (msg: any) { return new DevLogger() }
}
const authErrorRegex = /authentication/i
async function doNothing () {}
export class GQLServer extends Server {
  constructor (config?: FastifyTxStateOptions) {
    super({
      logger: (process.env.NODE_ENV !== 'development'
        ? {
            serializers: {
              req (request) {
                return {
                  method: request.method,
                  url: request.url,
                  params: request.params,
                  traceparent: request.headers.traceparent
                }
              },
              res (reply) {
                return {
                  statusCode: reply.statusCode,
                  ...((reply as any).gqlInfo ? (reply as any).gqlInfo : {})
                }
              }
            }
          }
        : new DevLogger()),
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

    if (options.playgroundEndpoint !== false && process.env.GRAPHQL_PLAYGROUND !== 'false') {
      this.app.get(options.playgroundEndpoint ?? '/', async (req, res) => {
        res = res.type('text/html')
        const pg = (await readFile(path.join(__dirname, 'playground.html'))).toString('utf-8')
        return pg.replace(/GRAPHQL_ENDPOINT/, options.gqlEndpoint![0]).replace(/GRAPHQL_SETTINGS/, JSON.stringify(options.playgroundSettings))
      })
    }
    if (options.voyagerEndpoint !== false && process.env.GRAPHQL_VOYAGER !== 'false') {
      this.app.get(options.voyagerEndpoint ?? '/voyager', async (req, res) => {
        res = res.type('text/html')
        const pg = (await readFile(path.join(__dirname, 'voyager.html'))).toString('utf-8')
        return options.gqlEndpoint ? pg.replace(/GRAPHQL_ENDPOINT/, options.gqlEndpoint[0]) : pg
      })
    }

    let schema = lexicographicSortSchema(await buildSchema({
      ...options,
      validate: false
    }))
    if (options.federated) {
      schema = buildFederationSchema(schema)
    }
    const validateRules = options.introspection && process.env.GRAPHQL_INTROSPECTION !== 'false' ? [] : [NoIntrospection]
    const parsedQueryCache = new Cache(async (query: string) => {
      const parsedQuery = parse(query)
      const errors = validate(schema, parsedQuery, validateRules)
      if (errors.length) return new ParseError(query, errors)
      return parsedQuery
    }, {
      freshseconds: 3600,
      staleseconds: 7200
    })
    const persistedQueryCache = new LRU({
      max: 1024 * 1024,
      length: (entry: string) => entry.length
    })
    const persistedVerifiedQueryDigestCache = new LRU<string, boolean>({
      max: 1024 * 1024 * 2,
      length: (entry: boolean, key: string) => key.length + 1
    })
    const handlePost = async (req: FastifyRequest<GQLRequest>, res: FastifyReply) => {
      try {
        const ctx = new (options.customContext ?? Context)(req)
        await ctx.waitForAuth()
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        if ((options.send401 || options.requireSignedQueries) && ctx.auth == null) throw new HttpError(401, 'all graphql requests require authentication, including introspection')
        let query: string|undefined = req.body.query
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
        const hash = req.body.extensions?.persistedQuery?.sha256Hash
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
        const operationName: string|undefined = req.body.operationName ?? (parsedQuery.definitions.find((def) => def.kind === 'OperationDefinition') as OperationDefinitionNode)?.name?.value;
        (res as any).gqlInfo = { auth: ctx.auth, operationName, query }
        const start = new Date()
        const ret = await execute(schema, parsedQuery, {}, ctx, req.body.variables, req.body.operationName)
        if (ret?.errors?.length) {
          if (ret.errors.some(e => authErrorRegex.test(e.message))) throw new AuthError()
          req.log.error(new ExecutionError(query, ret.errors).toString())
        }
        if (operationName !== 'IntrospectionQuery') {
          const queryTime = new Date().getTime() - start.getTime()
          options.after!(queryTime, operationName, query, ctx.auth, req.body.variables).catch(res.log.error)
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
    return await super.start(options.port)
  }
}
