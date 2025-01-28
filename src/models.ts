import { Field, InputType } from 'type-graphql'

@InputType()
export class UploadInfo {
  @Field()
  _type!: string

  @Field()
  multipartIndex!: number

  @Field()
  name!: string

  @Field()
  mime!: string

  @Field()
  size!: number
}
