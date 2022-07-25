import { AuthorizedService } from '../../src'
import { Meeting, MeetingFilter } from './meeting.model'
import { getMeetings, inMeeting } from './meeting.database'
import { Person, PersonFilter } from '../person/person.model'

export class MeetingService extends AuthorizedService {
  async find (filter?: MeetingFilter) {
    return await this.removeUnauthorized(await getMeetings(filter))
  }

  async findById (meetingId: number) {
    const meeting = (await getMeetings({ ids: [meetingId] }))?.[0]
    if (meeting != null) {
      return (await this.removeUnauthorized([]))?.[0]
    } else {
      return undefined
    }
  }

  async findByPerson (person: Person, filter?: PersonFilter) {
    return await this.removeUnauthorized(await getMeetings({ ...filter, peopleIds: [person.id] }))
  }

  // If requester has an id then force restriction, otherwise allow all requests to view meetings.
  protected async mayView (obj: any): Promise<boolean> {
    let requesterId = (await this.ctx.auth)?.sub
    requesterId = requesterId ? parseInt(requesterId) : undefined
    return (requesterId != null) ? await inMeeting((obj as Meeting).id, requesterId) : true
  }
}
