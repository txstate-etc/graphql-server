import 'reflect-metadata'
import Server, { HttpError } from 'fastify-txstate'
import { readFile } from 'fs/promises'
import { execute, parse, validate } from 'graphql'
import LRU from 'lru-cache'
import { Cache } from 'txstate-utils'
import { buildSchema, NonEmptyArray } from 'type-graphql'
import { Context } from './context'
import { ExecutionError, ParseError } from './errors'
import { shasum } from './util'

export class GQLServer extends Server {
  public async start (options?: number | { port?: number, resolvers: NonEmptyArray<Function>, gqlEndpoint: string, playgroundEndpoint: string }) {
    if (typeof options === 'number' || !options?.resolvers?.length) throw new Error('Must start graphql server with some resolvers.')
    const schema = await buildSchema({
      resolvers: options.resolvers,
      validate: false
    })
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
      const pg = (await readFile('playground.html')).toString('utf-8')
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
        const ret = await execute(schema, parsedQuery, {}, new Context(req), req.body.variables, req.body.operationName)
        if (ret?.errors?.length) console.error(new ExecutionError(req.body.query, ret.errors).toString())
        console.debug(`${new Date().getTime() - start.getTime()}ms`, req.body.query)
        return ret
      }
    )
    return await super.start(options.port)
  }
}
