import { AuthorizedService } from '../../src/index.ts'
import type { Meeting, MeetingFilter } from './meeting.model.ts'
import { getMeetings, inMeeting } from './meeting.database.ts'
import type { Person, PersonFilter } from '../person/person.model.ts'

export class MeetingService extends AuthorizedService {
  async find (filter?: MeetingFilter) {
    return await this.removeUnauthorized(await getMeetings(filter))
  }

  async findById (meetingId: number) {
    const meeting = (await getMeetings({ ids: [meetingId] })).at(0)
    if (meeting != null) {
      return (await this.removeUnauthorized([])).at(0)
    } else {
      return undefined
    }
  }

  async findByPerson (person: Person, filter?: PersonFilter) {
    return await this.removeUnauthorized(await getMeetings({ ...filter, peopleIds: [person.id] }))
  }

  // If requester has an id then force restriction, otherwise allow all requests to view meetings.
  protected async mayView (obj: any): Promise<boolean> {
    const username = this.ctx.auth?.username
    const requesterId = username ? parseInt(username, 10) : undefined
    return (requesterId != null) ? await inMeeting((obj as Meeting).id, requesterId) : true
  }
}
