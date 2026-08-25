import { AuthorizedService, AuthorizedServiceSync, cloneModel } from '../../src/index.ts'
import type { Document } from './document.model.ts'
import { getDocuments } from './document.database.ts'

export class DocumentService extends AuthorizedServiceSync {
  async find () {
    return this.removeUnauthorized(await getDocuments())
  }

  protected removeProperties (object: Document): Document {
    const username = this.ctx.auth?.username
    const requesterId = username ? parseInt(username, 10) : undefined
    if (requesterId === object.ownerId) return object
    return cloneModel(object, { secret: undefined })
  }
}

/**
 * Deliberately broken twin of DocumentService: it redacts with an object spread, which drops
 * the Document prototype and makes type-graphql re-run the constructor with no arguments
 * while resolving the shoutingTitle field. Exists so a test can document that failure mode.
 */
export class DocumentSpreadService extends AuthorizedService {
  async find () {
    return await this.removeUnauthorized(await getDocuments())
  }

  protected async removeProperties (object: Document): Promise<Document> {
    const username = this.ctx.auth?.username
    const requesterId = username ? parseInt(username, 10) : undefined
    if (requesterId === object.ownerId) return object
    const plainClone = { ...object, secret: undefined }
    // the cast is a hint at how wrong this is: the spread dropped the prototype, so the
    // clone is missing the shoutingTitle method along with its class identity
    return plainClone as unknown as Document
  }
}
