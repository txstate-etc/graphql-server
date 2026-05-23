import { AuthorizedService } from '../../src/index.ts'
import type { Person, PersonFilter } from './person.model.ts'
import { getPeople } from './person.database.ts'
import type { Meeting } from '../meeting/meeting.model.ts'
import { hostForPerson, shareMeeting } from '../meeting/meeting.database.ts'

export class PersonService extends AuthorizedService {
  async find (filter?: PersonFilter) {
    return await this.removeUnauthorized(await getPeople(filter))
  }

  async findByMeeting (meeting: Meeting, filter?: PersonFilter) {
    return await this.removeUnauthorized(await getPeople({ ...filter, ids: meeting.peopleIds }))
  }

  protected async mayView (obj: Person): Promise<boolean> {
    const username = this.ctx.auth?.username
    const requesterId = username ? parseInt(username, 10) : undefined
    const id = obj.id
    // If requester is looking at their own data then allow
    if (requesterId === undefined || requesterId === id) {
      return true
    } else {
      // If requester shares a meeting then allow
      return await shareMeeting(requesterId, id)
    }
  }

  protected async removeProperties (object: Person): Promise<Person> {
    const username = this.ctx.auth?.username
    const requesterId = username ? parseInt(username, 10) : undefined
    const id = object.id
    if (requesterId === undefined || requesterId === id) {
      return object
    } else if (await hostForPerson(requesterId, id)) {
      return object
    } else {
      // do not mutate our input
      return { ...object, contact: undefined }
    }
  }
}
