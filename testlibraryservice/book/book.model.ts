import { Directive, Field, Int, ObjectType } from 'type-graphql'

@Directive('@extends')
@Directive('@key(fields: "id")')
@ObjectType()
export class Book {
  @Directive('@external')
  @Field(type => Int)
  id!: number

  @Directive('@external')
  @Field()
  title?: string
}
