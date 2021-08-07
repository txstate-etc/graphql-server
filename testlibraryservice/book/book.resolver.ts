import { Ctx, Directive, FieldResolver, Resolver, Root } from 'type-graphql'
import { Context } from '../../src'
import { Library } from '../library/library.model'
import { LibraryService } from '../library/library.service'
import { Book } from './book.model'

@Resolver(of => Book)
export class BookResolver {
  @FieldResolver(returns => [Library])
  async libraries (@Ctx() ctx: Context, @Root() stub: Book) {
    return await ctx.svc(LibraryService).findByBook(stub)
  }

  @Directive('@requires(fields: "title")')
  @FieldResolver(returns => String)
  upperCaseTitle (@Root() stub: Book) {
    return stub.title!.toLocaleUpperCase()
  }
}
