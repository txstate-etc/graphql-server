import { Directive, Field, InputType, Int, ObjectType } from 'type-graphql'

@Directive('@key(fields: "id")')
@ObjectType()
export class Meeting {
  @Field(type => Int)
  id!: number

  @Field(type => String)
  title!: string

  hosts!: number[]

  peopleIds!: number[]
}

@InputType()
export class MeetingFilter {
  @Field(type => [Int], { nullable: true })
  ids?: number[]

  @Field(type => [Int], { nullable: true })
  peopleIds?: number[]

  @Field(type => String, { nullable: true })
  search?: string
}
