import { AuthorizedService } from '../../src'
import { Person, PersonFilter } from './person.model'
import { getPeople } from './person.database'
import { Meeting } from '../meeting/meeting.model'
import { hostForPerson, shareMeeting } from '../meeting/meeting.database'

export class PersonService extends AuthorizedService {
  async find (filter?: PersonFilter) {
    return await this.removeUnauthorized(await getPeople(filter))
  }

  async findByMeeting (meeting: Meeting, filter?: PersonFilter) {
    return await this.removeUnauthorized(await getPeople({ ...filter, ids: meeting.peopleIds }))
  }

  protected async mayView (obj: Person): Promise<boolean> {
    let requesterId = (await this.ctx.auth)?.sub
    requesterId = requesterId ? parseInt(requesterId) : undefined
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
    let requesterId = (await this.ctx.auth)?.sub
    requesterId = requesterId ? parseInt(requesterId) : undefined
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
