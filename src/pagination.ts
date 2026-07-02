import { Resolver, Query, Field, InputType, Int, ObjectType, registerEnumType } from 'type-graphql'

enum SortDirection {
  ASC = 'ASC',
  DESC = 'DESC'
}

registerEnumType(SortDirection, {
  name: 'SortDirection',
  description: 'Direction to sort results.'
})

export { SortDirection }

/**
 * The `perPage` applied when a paginated query is requested but the client omits `perPage`,
 * unless overridden per query with the `defaultPageSize` option on `executePaginated` /
 * `executeCursorPaginated`.
 */
export const DEFAULT_PAGE_SIZE = 100

/** Effective "no limit" for unpaginated queries: max signed 32-bit int, safe as a LIMIT across all popular databases. */
const NO_PAGINATION_LIMIT = 2_147_483_647

@ObjectType()
@InputType('SortEntryInput')
export class SortEntry {
  @Field(type => String, { description: 'Field to sort by.' })
  field!: string

  @Field(type => SortDirection, { nullable: true, defaultValue: SortDirection.ASC, description: 'Sort direction, either ASC or DESC. Optional; defaults to ASC.' })
  direction?: SortDirection
}

@ObjectType()
export class SortedResponse {
  @Field(type => [SortEntry], { nullable: true, description: 'If sorting was applied, the sort order used.' })
  sortOrder?: SortEntry[]

  constructor (info?: { sortOrder?: SortEntry[] }) {
    this.sortOrder = info?.sortOrder
  }
}

@InputType()
export class ListOptions {
  @Field(type => Int, { nullable: true, description: 'Page number for pagination.' })
  page?: number

  @Field(type => Int, { nullable: true, description: 'Number of results to fetch per page.' })
  perPage?: number
}

@ObjectType()
export class PaginationResponse extends SortedResponse {
  @Field(type => Int, { description: 'Total number of pages available.' })
  finalPage: number

  @Field(type => Int, { description: 'Current page number.' })
  page: number

  @Field(type => Int, { description: 'Number of results per page.' })
  perPage: number

  constructor (info?: { finalPage?: number, page?: number, perPage?: number, sortOrder?: SortEntry[], defaultPageSize?: number }) {
    super(info)
    // clamp client-controlled numbers: page < 1 would make the usual `(page - 1) * perPage` slice
    // math read from the end of the result set, and perPage < 1 would divide by zero in finalPage
    this.page = Math.max(1, info?.page ?? 1)
    this.perPage = Math.max(1, info?.perPage ?? (info?.page != null ? (info.defaultPageSize ?? DEFAULT_PAGE_SIZE) : NO_PAGINATION_LIMIT))
    this.finalPage = info?.finalPage ?? this.page
  }
}

@InputType()
export class CursorListOptions {
  @Field(type => Int, { nullable: true, description: 'Number of results per page.' })
  perPage?: number

  @Field(type => String, { nullable: true, description: 'Return results after this cursor (not inclusive). Omit to start from the beginning.' })
  after?: string
}

@ObjectType()
export class CursorResponse extends SortedResponse {
  @Field(type => Int, { nullable: true, description: 'Number of results per page, echoed from the request.' })
  perPage?: number

  @Field(type => String, { nullable: true, description: 'The cursor results were requested after, echoed from the request.' })
  after?: string

  @Field(type => Boolean, { description: 'Whether more results exist after `endCursor`.' })
  hasNextPage: boolean

  @Field(type => String, { nullable: true, description: 'Cursor of the last result on this page; pass it back as `after` to fetch the next page.' })
  endCursor?: string

  constructor (info?: { perPage?: number, after?: string, hasNextPage?: boolean, endCursor?: string, sortOrder?: SortEntry[], defaultPageSize?: number }) {
    super(info)
    // clamp like PaginationResponse: a client-supplied perPage < 1 must not reach LIMIT/slice math
    this.perPage = Math.max(1, info?.perPage ?? (info?.after != null ? (info.defaultPageSize ?? DEFAULT_PAGE_SIZE) : NO_PAGINATION_LIMIT))
    this.after = info?.after
    this.hasNextPage = info?.hasNextPage ?? false
    this.endCursor = info?.endCursor
  }
}

/**
 * The return type of the top-level `pageInfo` query. It carries no fields of its own;
 * each app adds one `@FieldResolver` per paginated top-level Query field so clients can
 * fetch the `PaginationResponse` for that field alongside the results.
 *
 * See the README "Pagination" section for the full opt-in pattern.
 */
@ObjectType()
export class PageInformation {}

/**
 * Ships the generic `pageInfo` Query. Register this resolver alongside one or more of
 * your own `@Resolver(of => PageInformation)` classes that declare a `@FieldResolver`
 * per paginated query, e.g.
 *
 * ```ts
 * @Resolver(of => PageInformation)
 * export class MyPageInfoResolver {
 *   @FieldResolver(returns => PaginationResponse)
 *   async books (@Ctx() ctx: Context) {
 *     return await ctx.getPaginationInfo('books')
 *   }
 * }
 * ```
 *
 * `PageInformation` has no fields on its own, so the schema will only build if at least
 * one field resolver is registered for it.
 */
@Resolver(of => PageInformation)
export class PageInformationResolver {
  @Query(returns => PageInformation, { description: 'Retrieve pagination information for paginated top-level queries made in the same request.' })
  pageInfo () {
    return new PageInformation()
  }
}
