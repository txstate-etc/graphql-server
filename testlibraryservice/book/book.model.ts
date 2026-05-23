import { Directive, Field, Int, ObjectType } from 'type-graphql'

@Directive('@key(fields: "id")')
@ObjectType()
export class Book {
  @Field(type => Int)
  id!: number

  @Directive('@external')
  @Field(type => String)
  title?: string
}
