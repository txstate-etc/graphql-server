import { Arg, Ctx, FieldResolver, Query, Resolver, Root } from 'type-graphql'
import { Context } from '../../src'
import { Meeting, MeetingFilter } from '../meeting/meeting.model'
import { MeetingService } from '../meeting/meeting.service'
import { Person, PersonFilter } from './person.model'
import { PersonService } from './person.service'

@Resolver(of => Person)
export class PersonResolver {
  @Query(returns => [Person])
  async people (@Ctx() ctx: Context, @Arg('filter', { nullable: true }) filter?: PersonFilter) {
    return await ctx.svc(PersonService).find(filter)
  }

  @FieldResolver(returns => Person)
  async resolveReference (@Ctx() ctx: Context, @Root() stub: Pick<Person, 'id'>) {
    return await ctx.svc(PersonService).find({ ids: [stub.id] })
  }

  @FieldResolver(returns => [Meeting])
  async meetings (@Ctx() ctx: Context, @Root() person: Person, @Arg('filter', { nullable: true }) filter?: MeetingFilter) {
    return await ctx.svc(MeetingService).findByPerson(person, filter)
  }
}
