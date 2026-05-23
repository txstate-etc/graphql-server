import { Arg, Ctx, FieldResolver, Query, Resolver, Root } from 'type-graphql'
import { Context, ResolveReference } from '../../src/index.ts'
import { Person } from '../person/person.model.ts'
import { PersonService } from '../person/person.service.ts'
import { Meeting, MeetingFilter } from './meeting.model.ts'
import { MeetingService } from './meeting.service.ts'

@Resolver(of => Meeting)
export class MeetingResolver {
  @Query(returns => [Meeting])
  async meetings (@Ctx() ctx: Context, @Arg('filter', type => MeetingFilter, { nullable: true }) filter?: MeetingFilter) {
    return await ctx.svc(MeetingService).find(filter)
  }

  @ResolveReference('Meeting')
  async resolveReference (stub: Pick<Meeting, 'id'>, _args: any, ctx: Context) {
    return await ctx.svc(MeetingService).findById(stub.id)
  }

  @FieldResolver(returns => [Person])
  async people (@Ctx() ctx: Context, @Root() meeting: Meeting, @Arg('filter', type => MeetingFilter, { nullable: true }) filter?: MeetingFilter) {
    return await ctx.svc(PersonService).findByMeeting(meeting, filter)
  }
}
