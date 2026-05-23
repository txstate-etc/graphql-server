import { Resolver, FieldResolver, Root, Ctx, Query, Arg } from 'type-graphql'
import { Context } from '../../src/index.ts'
import { Book } from '../book/book.model.ts'
import { Library, LibraryFilter } from './library.model.ts'
import { LibraryService } from './library.service.ts'

@Resolver(of => Library)
export class LibraryResolver {
  @Query(returns => [Library])
  async libraries (@Ctx() ctx: Context, @Arg('filter', type => LibraryFilter, { nullable: true }) filter?: LibraryFilter) {
    return await ctx.svc(LibraryService).find(filter)
  }

  @FieldResolver(returns => [Book])
  async books (@Ctx() ctx: Context, @Root() library: Library) {
    return library.bookIds.map(id => ({ id }))
  }
}
