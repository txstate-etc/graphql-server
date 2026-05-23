import { Directive, Field, InputType, Int, ObjectType } from 'type-graphql'

@Directive('@key(fields: "id")')
@ObjectType()
export class Person {
  @Field(type => Int)
  id!: number

  @Field(type => String)
  name!: string

  @Field(type => String, { nullable: true })
  contact?: string
}

@InputType()
export class PersonFilter {
  @Field(type => [Int], { nullable: true })
  ids?: number[]

  @Field(type => String, { nullable: true })
  search?: string
}
