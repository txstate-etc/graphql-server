import { Directive, Field, InputType, Int, ObjectType } from 'type-graphql'

@Directive('@key(fields: "id")')
@ObjectType()
export class Author {
  @Field(type => Int)
  id!: number

  @Field()
  name!: string
}

@InputType()
export class AuthorFilter {
  @Field(type => [Int], { nullable: true })
  ids?: number[]

  @Field({ nullable: true })
  search?: string
}
