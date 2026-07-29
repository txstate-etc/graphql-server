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
export class Pagination {
  @Field(type => Int, { nullable: true, description: 'Page number for pagination.' })
  page?: number

  @Field(type => Int, { nullable: true, description: 'Number of results to fetch per page.' })
  perPage?: number
}

@ObjectType()
export class PaginationResponse extends SortedResponse {
  /**
   * The total result count, settable by your service but deliberately NOT a GraphQL field on this
   * class. If it were, it would have to be nullable for everyone, even though any given API either
   * always fills it in or never does — and type-graphql inheritance can't remove a parent's field
   * from a subclass. So the base class keeps it internal, and an API that provides it declares so
   * by returning `PaginationResponseWithTotals` from its `PageInformation` field resolvers, which
   * exposes this same property as a non-nullable `totalItems` field.
   */
  totalItems?: number

  /**
   * Not a GraphQL field here either — `PaginationResponseWithTotals` exposes it, since a backend
   * that can count pages can nearly always count items too. The logic lives on this class because
   * `executePaginated` constructs the base class; the subclass only changes what the schema
   * advertises. Set `pageInfo.totalItems` and this derives itself; setting `finalPage` directly
   * also works — an explicit value wins over the derived one — for the rare backend that somehow
   * knows its page count but not its item count.
   */
  get finalPage (): number {
    if (this._finalPage != null) return this._finalPage
    if (this.totalItems != null) return Math.max(1, Math.ceil(this.totalItems / this.perPage))
    return this.page
  }

  set finalPage (finalPage: number) {
    this._finalPage = finalPage
  }

  private _finalPage?: number

  @Field(type => Int, { description: 'Current page number.' })
  page: number

  @Field(type => Int, { description: 'Number of results per page.' })
  perPage: number

  constructor (info?: { finalPage?: number, totalItems?: number, page?: number, perPage?: number, sortOrder?: SortEntry[], defaultPageSize?: number }) {
    super(info)
    // clamp client-controlled numbers: page < 1 would make the usual `(page - 1) * perPage` slice
    // math read from the end of the result set, and perPage < 1 would divide by zero when
    // finalPage derives itself from totalItems
    this.page = Math.max(1, info?.page ?? 1)
    this.perPage = Math.max(1, info?.perPage ?? (info?.page != null ? (info.defaultPageSize ?? DEFAULT_PAGE_SIZE) : NO_PAGINATION_LIMIT))
    this.totalItems = info?.totalItems
    this._finalPage = info?.finalPage
  }
}

/**
 * Use this as the return type of a `PageInformation` field resolver (and the type argument to
 * `getPaginationInfo`) when the service behind it always sets `pageInfo.totalItems` — which should
 * be most services, since the count is usually in hand anyway. The schema then advertises
 * `totalItems` and `finalPage` as non-nullable; the plain `PaginationResponse` advertises neither,
 * so an API that never counts doesn't carry dead fields. If a service only sometimes knows the
 * count, declare your own subclass with `nullable: true` instead.
 */
@ObjectType()
export class PaginationResponseWithTotals extends PaginationResponse {
  @Field(type => Int, { description: 'Total number of results across all pages.' })
  override totalItems!: number

  @Field(type => Int, { description: 'Total number of pages available.' })
  override get finalPage (): number {
    return super.finalPage
  }

  override set finalPage (finalPage: number) {
    super.finalPage = finalPage
  }
}

@InputType()
export class CursorPagination {
  @Field(type => Int, { nullable: true, description: 'Number of results per page.' })
  perPage?: number

  @Field(type => String, { nullable: true, description: 'Return results after this cursor (not inclusive). Omit to start from the beginning.' })
  after?: string
}

@ObjectType()
export class CursorResponse extends SortedResponse {
  /**
   * The total result count, settable by your service but not a GraphQL field on this class — see
   * the note on `PaginationResponse.totalItems`; expose it by returning `CursorResponseWithTotalItems`
   * from your `PageInformation` field resolver. Purely informational here — nothing derives from it,
   * since a cursor page has no page number to multiply against. Skip it when counting would cost
   * an extra query, which is common in the setups where cursor pagination gets chosen.
   */
  totalItems?: number

  @Field(type => Int, { nullable: true, description: 'Number of results per page, echoed from the request.' })
  perPage?: number

  @Field(type => String, { nullable: true, description: 'The cursor results were requested after, echoed from the request.' })
  after?: string

  @Field(type => Boolean, { description: 'Whether more results exist after `endCursor`.' })
  hasNextPage: boolean

  @Field(type => String, { nullable: true, description: 'Cursor of the last result on this page; pass it back as `after` to fetch the next page.' })
  endCursor?: string

  constructor (info?: { totalItems?: number, perPage?: number, after?: string, hasNextPage?: boolean, endCursor?: string, sortOrder?: SortEntry[], defaultPageSize?: number }) {
    super(info)
    // clamp like PaginationResponse: a client-supplied perPage < 1 must not reach LIMIT/slice math
    this.perPage = Math.max(1, info?.perPage ?? (info?.after != null ? (info.defaultPageSize ?? DEFAULT_PAGE_SIZE) : NO_PAGINATION_LIMIT))
    this.totalItems = info?.totalItems
    this.after = info?.after
    this.hasNextPage = info?.hasNextPage ?? false
    this.endCursor = info?.endCursor
  }
}

/**
 * The cursor-pagination counterpart to `PaginationResponseWithTotals`: return this from your
 * `PageInformation` field resolver when the service always sets `pageInfo.totalItems`. There is no
 * `finalPage` here — cursor pages have no page numbers — hence the narrower name.
 */
@ObjectType()
export class CursorResponseWithTotalItems extends CursorResponse {
  @Field(type => Int, { description: 'Total number of results across all pages.' })
  override totalItems!: number
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
