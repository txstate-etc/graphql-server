import { Arg, Ctx, FieldResolver, Int, Mutation, Query, Resolver, Root } from 'type-graphql'
import { AuthError, Context, ResolveReference, UploadInfo } from '../../src'
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

  @FieldResolver(returns => Boolean)
  async authTest () {
    throw new AuthError()
  }

  @Mutation(returns => [Int])
  async uploadBookData (@Ctx() ctx: Context, @Arg('file', type => UploadInfo) file: UploadInfo) {
    const sizes: number[] = []
    for await (const f of ctx.files()) {
      let size = 0
      for await (const chunk of f.stream) size += chunk.length
      sizes.push(size)
    }
    return sizes
  }
}
