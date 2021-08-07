import { Directive, Field, InputType, Int, ObjectType } from 'type-graphql'

@Directive('@key(fields: "id")')
@ObjectType()
export class Book {
  @Field(type => Int)
  id!: number

  @Field()
  title!: string

  authorIds!: number[]
}

@InputType()
export class BookFilter {
  @Field(type => [Int], { nullable: true })
  ids?: number[]

  @Field(type => [Int], { nullable: true })
  authorIds?: number[]

  @Field({ nullable: true })
  search?: string
}
