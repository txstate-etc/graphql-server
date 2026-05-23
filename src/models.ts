import type { Readable } from 'node:stream'
import { Field, Float, InputType } from 'type-graphql'

@InputType()
export class UploadInfo {
  @Field(type => String)
  _type!: string

  @Field(type => Float)
  multipartIndex!: number

  @Field(type => String)
  name!: string

  @Field(type => String)
  mime!: string

  @Field(type => Float)
  size!: number
}

export type UploadFiles = AsyncIterableIterator<{
  multipartIndex: number
  name: string
  mime: string
  stream: Readable
}>
