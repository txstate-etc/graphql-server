import { Arg, Ctx, FieldResolver, Query, Resolver, Root } from 'type-graphql'
import { Context } from '../../src/index.ts'
import { Meeting, MeetingFilter } from '../meeting/meeting.model.ts'
import { MeetingService } from '../meeting/meeting.service.ts'
import { Person, PersonFilter } from './person.model.ts'
import { PersonService } from './person.service.ts'

@Resolver(of => Person)
export class PersonResolver {
  @Query(returns => [Person])
  async people (@Ctx() ctx: Context, @Arg('filter', type => PersonFilter, { nullable: true }) filter?: PersonFilter) {
    return await ctx.svc(PersonService).find(filter)
  }

  @FieldResolver(returns => Person)
  async resolveReference (@Ctx() ctx: Context, @Root() stub: Pick<Person, 'id'>) {
    return await ctx.svc(PersonService).find({ ids: [stub.id] })
  }

  @FieldResolver(returns => [Meeting])
  async meetings (@Ctx() ctx: Context, @Root() person: Person, @Arg('filter', type => MeetingFilter, { nullable: true }) filter?: MeetingFilter) {
    return await ctx.svc(MeetingService).findByPerson(person, filter)
  }
}
