import { Arg, Ctx, FieldResolver, Query, Resolver, Root } from 'type-graphql'
import { Context } from '../../src/index.ts'
import { Book, BookFilter } from '../book/book.model.ts'
import { BookService } from '../book/book.service.ts'
import { Author, AuthorFilter } from './author.model.ts'
import { AuthorService } from './author.service.ts'

@Resolver(of => Author)
export class AuthorResolver {
  @Query(returns => [Author])
  async authors (@Ctx() ctx: Context, @Arg('filter', type => AuthorFilter, { nullable: true }) filter?: AuthorFilter) {
    return await ctx.svc(AuthorService).find(filter)
  }

  @FieldResolver(returns => Author)
  async resolveReference (@Ctx() ctx: Context, @Root() stub: Pick<Author, 'id'>) {
    return await ctx.svc(AuthorService).find({ ids: [stub.id] })
  }

  @FieldResolver(returns => [Book])
  async books (@Ctx() ctx: Context, @Root() author: Author, @Arg('filter', type => BookFilter, { nullable: true }) filter?: BookFilter) {
    return await ctx.svc(BookService).findByAuthor(author, filter)
  }
}
