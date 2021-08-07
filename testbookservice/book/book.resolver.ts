import { Arg, Ctx, FieldResolver, Query, Resolver, Root } from 'type-graphql'
import { Context, ResolveReference } from '../../src'
import { Author, AuthorFilter } from '../author/author.model'
import { AuthorService } from '../author/author.service'
import { Book, BookFilter } from './book.model'
import { BookService } from './book.service'

@Resolver(of => Book)
export class BookResolver {
  @Query(returns => [Book])
  async books (@Ctx() ctx: Context, @Arg('filter', { nullable: true }) filter?: BookFilter) {
    return await ctx.svc(BookService).find(filter)
  }

  @ResolveReference('Book')
  async resolveReference (stub: Pick<Book, 'id'>, _args: any, ctx: Context) {
    return await ctx.svc(BookService).findById(stub.id)
  }

  @FieldResolver(returns => [Author])
  async authors (@Ctx() ctx: Context, @Root() book: Book, @Arg('filter', { nullable: true }) filter?: AuthorFilter) {
    return await ctx.svc(AuthorService).findByBook(book, filter)
  }
}
