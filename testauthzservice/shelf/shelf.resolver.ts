import { PrimaryKeyLoader } from 'dataloader-factory'
import { HttpError, withSpan } from 'fastify-txstate'
import { sleep } from 'txstate-utils'
import { Ctx, Field, FieldResolver, Int, Mutation, ObjectType, Query, Resolver, Root } from 'type-graphql'
import { Context } from '../../src/index.ts'

/**
 * Fixtures for test/10.otel.ts, which asserts on the telemetry this service exports. Shelf has
 * one of each kind of field: plain properties, a deprecated one, a synchronous `@Field` method,
 * and a `@FieldResolver` that batches through a dataloader.
 */
@ObjectType()
class Shelf {
  @Field(type => Int)
  id: number

  @Field(type => String)
  label: string

  @Field(type => String, { deprecationReason: 'Use label instead.' })
  name: string

  constructor (id: number) {
    this.id = id
    this.label = `Shelf ${id}`
    this.name = this.label
  }

  @Field(type => String)
  summary () {
    return `${this.label} (#${this.id})`
  }
}

// stands in for a database: the span is what a real query would have made
const contentsLoader = new PrimaryKeyLoader({
  fetch: async (ids: number[]) => await withSpan('fake.db.query', async () => {
    await sleep(5)
    return ids.map(id => ({ id, contents: `Contents of shelf ${id}` }))
  })
})

@Resolver(of => Shelf)
export class ShelfResolver {
  @Query(returns => [Shelf])
  shelves () {
    return [1, 2, 3, 4, 5].map(id => new Shelf(id))
  }

  @Query(returns => String)
  boom (): string {
    throw new Error('kaboom')
  }

  @Query(returns => String)
  refused (): string {
    throw new HttpError(422, 'that request can not be processed')
  }

  @Mutation(returns => Boolean)
  restock () {
    return true
  }

  @FieldResolver(returns => String)
  async contents (@Ctx() ctx: Context, @Root() shelf: Shelf) {
    return (await ctx.loaders.get(contentsLoader).load(shelf.id))?.contents
  }
}
