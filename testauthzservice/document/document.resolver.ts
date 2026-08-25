import { Ctx, Query, Resolver } from 'type-graphql'
import { Context } from '../../src/index.ts'
import { Document } from './document.model.ts'
import { DocumentService, DocumentSpreadService } from './document.service.ts'

@Resolver(of => Document)
export class DocumentResolver {
  @Query(returns => [Document])
  async documents (@Ctx() ctx: Context) {
    return await ctx.svc(DocumentService).find()
  }

  @Query(returns => [Document], { description: 'Same data as documents, but redacted with a prototype-losing spread clone. Selecting shoutingTitle on a redacted result crashes; the test suite depends on that.' })
  async documentsSpreadClone (@Ctx() ctx: Context) {
    return await ctx.svc(DocumentSpreadService).find()
  }
}
