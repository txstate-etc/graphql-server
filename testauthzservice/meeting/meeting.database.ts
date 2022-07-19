import { isNotNull } from 'txstate-utils'
import { Meeting, MeetingFilter } from './meeting.model'

// NOTE hosts is a subset of peopleIds
export const meetingDb = new Map<number, Meeting>()
// 1 hosts meeting for 2
meetingDb.set(1, {
  id: 1,
  title: 'Meeting 1',
  hosts: [1],
  peopleIds: [1, 2]
})
// 2 hosts meeting for self only
meetingDb.set(2, {
  id: 2,
  title: 'Meeting 2',
  hosts: [2],
  peopleIds: [2]
})
// 1 attends meeting with 3 being the host
meetingDb.set(3, {
  id: 3,
  title: 'Meeting 3',
  hosts: [3],
  peopleIds: [1, 3]
})
// 4 attends no meetings

export async function inMeeting (id: number, person: number): Promise<boolean> {
  return meetingDb.get(id)?.peopleIds.includes(person) || false
}

export async function shareMeeting (person1: number, person2: number): Promise<boolean> {
  for (const meeting of meetingDb) {
    if (meeting[1].peopleIds.includes(person1) && meeting[1].peopleIds.includes(person2)) {
      return true
    }
  }
  return false
}

function isMeetingHost (id: number, person: number): boolean {
  return meetingDb.get(id)?.hosts.includes(person) || false  
}

export async function hostForPerson (host: number, person: number): Promise<boolean> {
  for (const meeting of meetingDb) {
    if (meeting[1].peopleIds.includes(host) && meeting[1].peopleIds.includes(person)) {
      if (isMeetingHost(meeting[0], host)) {
        return true
      }
    }
  }
  return false
}

export async function getMeetings (filter?: MeetingFilter) {
  let meetings = filter?.ids ? filter.ids.map(id => meetingDb.get(id)).filter(isNotNull) : Array.from(meetingDb.values())
  if (filter?.search) {
    const search = filter.search.toLowerCase()
    meetings = meetings.filter(book => book.title.toLocaleLowerCase().includes(search))
  }
  if (filter?.peopleIds) {
    const peopleSet = new Set(filter.peopleIds)
    meetings = meetings.filter(meeting => meeting.peopleIds.some(id => peopleSet.has(id)))
  }
  return meetings
}
