import 'reflect-metadata'
import { FastifyServerOptions } from 'fastify'
import Server, { HttpError } from 'fastify-txstate'
import { readFile } from 'fs/promises'
import { execute, lexicographicSortSchema, parse, validate } from 'graphql'
import http2 from 'http2'
import LRU from 'lru-cache'
import path from 'path'
import { Cache } from 'txstate-utils'
import { buildSchema, BuildSchemaOptions } from 'type-graphql'
import { Context, Type } from './context'
import { ExecutionError, ParseError } from './errors'
import { shasum } from './util'

export interface GQLStartOpts <CustomContext extends Context = Context> extends BuildSchemaOptions {
  port?: number
  gqlEndpoint?: string
  playgroundEndpoint?: string
  customContext?: Type<CustomContext>
}

export class GQLServer extends Server {
  constructor (config?: Partial<FastifyServerOptions & {
    http2: true
    https: http2.SecureServerOptions
  }>) {
    super({ logger: process.env.NODE_ENV !== 'development', ...config })
  }

  public async start (options?: number | GQLStartOpts) {
    if (typeof options === 'number' || !options?.resolvers?.length) throw new Error('Must start graphql server with some resolvers.')
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
    this.app.get(options.playgroundEndpoint ?? '/', async (req, res) => {
      res = res.type('text/html')
      const pg = (await readFile(path.join(__dirname, 'playground.html'))).toString('utf-8')
      return options.gqlEndpoint ? pg.replace(/endpoint: '\/graphql'/i, `endpoint: '${options.gqlEndpoint}'`) : pg
    })
    this.app.post<{ Body: { operationName: string, query: string, variables?: object, extensions?: { persistedQuery?: { version: number, sha256Hash: string } } } }>(options.gqlEndpoint ?? '/graphql',
      async req => {
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
        const ret = await execute(schema, parsedQuery, {}, new (options.customContext ?? Context)(req), req.body.variables, req.body.operationName)
        if (ret?.errors?.length) console.error(new ExecutionError(req.body.query, ret.errors).toString())
        if (req.body.operationName !== 'IntrospectionQuery') console.info(`${new Date().getTime() - start.getTime()}ms`, req.body.operationName ?? req.body.query)
        return ret
      }
    )
    return await super.start(options.port)
  }
}
