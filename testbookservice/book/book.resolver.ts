import { Arg, Ctx, FieldResolver, Int, Mutation, Query, Resolver, Root } from 'type-graphql'
import { AuthError, Context, CursorListOptions, CursorResponse, ListOptions, PageInformation, PaginationResponse, ResolveReference, SortEntry, UploadInfo } from '../../src/index.ts'
import { Author, AuthorFilter } from '../author/author.model.ts'
import { AuthorService } from '../author/author.service.ts'
import { Book, BookFilter } from './book.model.ts'
import { BookService } from './book.service.ts'

@Resolver(of => Book)
export class BookResolver {
  @Query(returns => [Book])
  async books (@Ctx() ctx: Context, @Arg('filter', type => BookFilter, { nullable: true }) filter?: BookFilter) {
    return await ctx.svc(BookService).find(filter)
  }

  @Query(returns => [Book], { description: 'Like `books`, but paginated. Request `pageInfo { pagedBooks { ... } }` in the same operation to read total page count.' })
  async pagedBooks (@Ctx() ctx: Context, @Arg('filter', type => BookFilter, { nullable: true }) filter?: BookFilter, @Arg('pagination', type => ListOptions, { nullable: true }) pagination?: ListOptions, @Arg('sort', type => [SortEntry], { nullable: true }) sort?: SortEntry[]) {
    return await ctx.executePaginated<Book[]>('pagedBooks', { pagination, sort, defaultPageSize: 7 }, async pageInfo => await ctx.svc(BookService).find(filter, pageInfo))
  }

  @Query(returns => [Book], { description: 'Cursor-paginated books. Request `pageInfo { cursorBooks { hasNextPage endCursor } }` to drive forward paging.' })
  async cursorBooks (@Ctx() ctx: Context, @Arg('filter', type => BookFilter, { nullable: true }) filter?: BookFilter, @Arg('pagination', type => CursorListOptions, { nullable: true }) pagination?: CursorListOptions, @Arg('sort', type => [SortEntry], { nullable: true }) sort?: SortEntry[]) {
    return await ctx.executeCursorPaginated<Book[]>('cursorBooks', { pagination, sort }, async pageInfo => await ctx.svc(BookService).findByCursor(filter, pageInfo))
  }

  @Query(returns => [Book], { description: 'Fetches the first 3 pagedBooks through a nested ctx.query() sub-operation; exists to verify sub-operations get isolated pagination state.' })
  async booksViaSubquery (@Ctx() ctx: Context) {
    const result = await ctx.query<{ data?: { pagedBooks: Book[] }, errors?: readonly Error[] }>('query ($p: ListOptions) { pagedBooks (pagination: $p) { id title } }', { p: { page: 1, perPage: 3 } })
    if (result.errors?.length) throw result.errors[0]
    return result.data?.pagedBooks ?? []
  }

  @ResolveReference('Book')
  async resolveReference (stub: Pick<Book, 'id'>, _args: any, ctx: Context) {
    return await ctx.svc(BookService).findById(stub.id)
  }

  @FieldResolver(returns => [Author])
  async authors (@Ctx() ctx: Context, @Root() book: Book, @Arg('filter', type => AuthorFilter, { nullable: true }) filter?: AuthorFilter) {
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

@Resolver(of => PageInformation)
export class BookPageInformationResolver {
  @FieldResolver(returns => PaginationResponse, { nullable: true })
  async pagedBooks (@Ctx() ctx: Context) {
    return await ctx.getPaginationInfo('pagedBooks')
  }

  @FieldResolver(returns => CursorResponse, { nullable: true })
  async cursorBooks (@Ctx() ctx: Context) {
    return await ctx.getPaginationInfo<CursorResponse>('cursorBooks')
  }
}
