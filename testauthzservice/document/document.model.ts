import { Field, Int, ObjectType } from 'type-graphql'

export interface DocumentRow {
  id: number
  title: string
  secret: string
  ownerId: number
}

/**
 * Unlike Person and Meeting, this model has a constructor that requires a DB row, plus a
 * @Field method (shoutingTitle) that type-graphql registers as a field resolver. That
 * combination is what makes prototype-losing clones dangerous: type-graphql converts the
 * root back to a Document while resolving shoutingTitle, and for a plain-object root that
 * means `new Document()` with no arguments — `row.id` throws. The cloneModel tests depend
 * on this constructor staying required and shoutingTitle staying a method.
 */
@ObjectType()
export class Document {
  constructor (row: DocumentRow) {
    this.id = row.id
    this.title = row.title
    this.secret = row.secret
    this.ownerId = row.ownerId
  }

  @Field(type => Int)
  id: number

  @Field(type => String)
  title: string

  @Field(type => String, { nullable: true, description: 'Only visible to the document owner; null for everyone else.' })
  secret?: string

  ownerId: number

  @Field(type => String)
  shoutingTitle (): string {
    return this.title.toUpperCase()
  }
}
