import type { MeetingFormat } from './enums'
import type { UserRefDto } from './workflow'

export interface MeetingParticipantDto {
  id: string
  /** Сотрудник ИТ-Школы, контактное лицо вуза или внешний участник. */
  kind: 'user' | 'contact' | 'external'
  name: string
  position: string | null
}

export interface MeetingLinksDto {
  cooperationId: string | null
  universityId: string | null
  universityName: string | null
  programId: string | null
  programName: string | null
}

export interface MeetingDto {
  id: string
  date: string
  topic: string
  format: MeetingFormat
  result: string | null
  nextAction: string | null
  nextActionDueAt: string | null
  responsible: UserRefDto
  participants: MeetingParticipantDto[]
  links: MeetingLinksDto
  createdAt: string
  updatedAt: string
}
