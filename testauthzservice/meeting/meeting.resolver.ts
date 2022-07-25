import { Arg, Ctx, FieldResolver, Query, Resolver, Root } from 'type-graphql'
import { Context, ResolveReference } from '../../src'
import { Person } from '../person/person.model'
import { PersonService } from '../person/person.service'
import { Meeting, MeetingFilter } from './meeting.model'
import { MeetingService } from './meeting.service'

@Resolver(of => Meeting)
export class MeetingResolver {
  @Query(returns => [Meeting])
  async meetings (@Ctx() ctx: Context, @Arg('filter', { nullable: true }) filter?: MeetingFilter) {
    return await ctx.svc(MeetingService).find(filter)
  }

  @ResolveReference('Meeting')
  async resolveReference (stub: Pick<Meeting, 'id'>, _args: any, ctx: Context) {
    return await ctx.svc(MeetingService).findById(stub.id)
  }

  @FieldResolver(returns => [Person])
  async people (@Ctx() ctx: Context, @Root() meeting: Meeting, @Arg('filter', { nullable: true }) filter?: MeetingFilter) {
    return await ctx.svc(PersonService).findByMeeting(meeting, filter)
  }
}
