import { Resolver, FieldResolver, Root, Ctx, Query, Arg } from 'type-graphql'
import { Context } from '../../src'
import { Book } from '../book/book.model'
import { Library, LibraryFilter } from './library.model'
import { LibraryService } from './library.service'

@Resolver(of => Library)
export class LibraryResolver {
  @Query(returns => [Library])
  async libraries (@Ctx() ctx: Context, @Arg('filter', { nullable: true }) filter?: LibraryFilter) {
    return await ctx.svc(LibraryService).find(filter)
  }

  @FieldResolver(returns => [Book])
  async books (@Ctx() ctx: Context, @Root() library: Library) {
    return library.bookIds.map(id => ({ id }))
  }
}
