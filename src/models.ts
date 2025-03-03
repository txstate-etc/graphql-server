import type { Readable } from 'node:stream'
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

export type UploadFiles = AsyncIterableIterator<{
  multipartIndex: number
  name: string
  mime: string
  stream: Readable
}>
