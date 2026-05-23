import { Ctx, Directive, FieldResolver, Resolver, Root } from 'type-graphql'
import { Context } from '../../src/index.ts'
import { Library } from '../library/library.model.ts'
import { LibraryService } from '../library/library.service.ts'
import { Book } from './book.model.ts'

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
