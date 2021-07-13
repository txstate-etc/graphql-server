import { FastifyRequest } from 'fastify'
import Server, { FastifyTxStateOptions, HttpError } from 'fastify-txstate'
import { readFile } from 'fs/promises'
import { execute, lexicographicSortSchema, OperationDefinitionNode, parse, validate } from 'graphql'
import LRU from 'lru-cache'
import path from 'path'
import { Cache, toArray } from 'txstate-utils'
import { buildSchema, BuildSchemaOptions } from 'type-graphql'
import { Context, Type } from './context'
import { ExecutionError, ParseError } from './errors'
import { shasum } from './util'

export interface GQLStartOpts <CustomContext extends Context = Context> extends BuildSchemaOptions {
  port?: number
  gqlEndpoint?: string|string[]
  playgroundEndpoint?: string|false
  voyagerEndpoint?: string|false
  customContext?: Type<CustomContext>
  send401?: boolean
}

export interface GQLRequest { Body: { operationName: string, query: string, variables?: object, extensions?: { persistedQuery?: { version: number, sha256Hash: string } } } }

export class GQLServer extends Server {
  constructor (config?: FastifyTxStateOptions) {
    super({ logger: process.env.NODE_ENV !== 'development', ...config })
  }

  public async start (options?: number | GQLStartOpts) {
    if (typeof options === 'number' || !options?.resolvers?.length) throw new Error('Must start graphql server with some resolvers.')
    options.gqlEndpoint ??= '/graphql'
    options.gqlEndpoint = toArray(options.gqlEndpoint)

    if (options.playgroundEndpoint !== false && process.env.GRAPHQL_PLAYGROUND !== 'false') {
      this.app.get(options.playgroundEndpoint ?? '/', async (req, res) => {
        res = res.type('text/html')
        const pg = (await readFile(path.join(__dirname, 'playground.html'))).toString('utf-8')
        return options.gqlEndpoint ? pg.replace(/GRAPHQL_ENDPOINT/, options.gqlEndpoint[0]) : pg
      })
    }
    if (options.voyagerEndpoint !== false && process.env.GRAPHQL_VOYAGER !== 'false') {
      this.app.get(options.voyagerEndpoint ?? '/voyager', async (req, res) => {
        res = res.type('text/html')
        const pg = (await readFile(path.join(__dirname, 'voyager.html'))).toString('utf-8')
        return options.gqlEndpoint ? pg.replace(/GRAPHQL_ENDPOINT/, options.gqlEndpoint[0]) : pg
      })
    }

    const schema = lexicographicSortSchema(await buildSchema({
      ...options,
      validate: false
    }))
    const parsedQueryCache = new Cache(async (query: string) => {
      const parsedQuery = parse(query)
      const errors = validate(schema, parsedQuery)
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
    const handlePost = async (req: FastifyRequest<GQLRequest>) => {
      let query: string|undefined = req.body.query
      const hash = req.body.extensions?.persistedQuery?.sha256Hash
      if (hash) {
        if (query) {
          if (hash !== shasum(query)) throw new HttpError(400, 'provided sha does not match query')
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
        console.error(parsedQuery.toString())
        return { errors: parsedQuery.errors }
      }
      const start = new Date()
      const ctx = new (options.customContext ?? Context)(req)
      await ctx.waitForAuth()
      if (options.send401 && ctx.auth == null) throw new HttpError(401, 'all graphql requests require authentication, including introspection')
      const ret = await execute(schema, parsedQuery, {}, ctx, req.body.variables, req.body.operationName)
      if (ret?.errors?.length) console.error(new ExecutionError(req.body.query, ret.errors).toString())
      if (req.body.operationName !== 'IntrospectionQuery' && (parsedQuery.definitions[0] as OperationDefinitionNode).name?.value !== 'IntrospectionQuery') console.info(`${new Date().getTime() - start.getTime()}ms`, req.body.operationName || req.body.query)
      return ret
    }

    for (const path of options.gqlEndpoint) {
      this.app.post(path, handlePost)
    }
    return await super.start(options.port)
  }
}
