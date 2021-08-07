import { Directive, ObjectType, Field, Int, InputType } from 'type-graphql'

@Directive('@key(fields: "id")')
@ObjectType()
export class Library {
  @Field(type => Int)
  id!: number

  bookIds!: number[]
}

@InputType()
export class LibraryFilter {
  @Field(type => [Int], { nullable: true })
  ids?: number[]

  @Field(type => [Int], { nullable: true })
  bookIds?: number[]
}
