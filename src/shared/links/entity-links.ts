import { prisma } from '@/shared/db/prisma'
import { isUniversityVisible } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { validationError } from '@/shared/http/errors'
import { canBeResponsible } from '@/shared/contracts/enums'

/**
 * Привязки документа и встречи: связка, вуз, программа — и люди в них.
 *
 * Мало проверить каждую привязку саму по себе (существует и видна): они обязаны
 * быть об одном и том же. Иначе встреча с вузом A, программой вуза B и контактным
 * лицом вуза B покажет представителю вуза A название чужой программы и ФИО
 * с должностью чужого контакта, а представителю B — название вуза A.
 *
 * Одна проверка на документы и встречи: всё, что указано, ведёт в один вуз.
 */
export interface EntityLinks {
  cooperationId?: string | null
  universityId?: string | null
  programId?: string | null
}

type LinkField = 'cooperationId' | 'universityId' | 'programId'

const mismatch = (field: LinkField, message: string) =>
  validationError('Привязки относятся к разным вузам', [{ field, message }])

/**
 * Проверяет привязки и возвращает вуз, к которому относится запись.
 * `null` — привязок нет (это проверяет сам модуль: без привязки запись не создаётся).
 */
export async function resolveEntityLinks(
  user: CurrentUser,
  links: EntityLinks,
): Promise<string | null> {
  let universityId: string | null = null
  let cooperationProgramId: string | null = null

  if (links.cooperationId) {
    const cooperation = await prisma.cooperation.findUnique({
      where: { id: links.cooperationId },
      select: { universityId: true, programId: true },
    })
    if (!cooperation || !isUniversityVisible(user, cooperation.universityId)) {
      throw validationError('Указана несуществующая связка', [
        { field: 'cooperationId', message: 'Связка не найдена' },
      ])
    }
    universityId = cooperation.universityId
    cooperationProgramId = cooperation.programId
  }

  if (links.universityId) {
    const university = await prisma.university.findUnique({
      where: { id: links.universityId },
      select: { id: true },
    })
    if (!university || !isUniversityVisible(user, links.universityId)) {
      throw validationError('Указан несуществующий вуз', [
        { field: 'universityId', message: 'Вуз не найден' },
      ])
    }
    if (universityId !== null && universityId !== links.universityId) {
      throw mismatch('universityId', 'Связка относится к другому вузу')
    }
    universityId = links.universityId
  }

  if (links.programId) {
    const program = await prisma.educationalProgram.findUnique({
      where: { id: links.programId },
      select: { universityId: true },
    })
    if (!program || !isUniversityVisible(user, program.universityId)) {
      throw validationError('Указана несуществующая программа', [
        { field: 'programId', message: 'Программа не найдена' },
      ])
    }
    if (universityId !== null && universityId !== program.universityId) {
      throw mismatch('programId', 'Программа относится к другому вузу')
    }
    if (cooperationProgramId !== null && cooperationProgramId !== links.programId) {
      throw mismatch('programId', 'У связки другая программа')
    }
    universityId = program.universityId
  }

  return universityId
}

/**
 * Ответственный — действующий администратор или менеджер ИТ-Школы (RESPONSIBLE_ROLES).
 *
 * Сервер принимал любого пользователя, включая представителя другого вуза:
 * фильтровал только интерфейс. Потом — любого сотрудника, и ответственным
 * становились аналитик и наблюдатель, которые запись изменить не могут.
 * Несуществующий id отклоняется здесь же: иначе он превращался в «Запись не
 * найдена» — будто не найден сам документ.
 */
export async function assertStaffResponsible(responsibleId: string): Promise<void> {
  const responsible = await prisma.user.findFirst({
    where: { id: responsibleId, isActive: true },
    select: { role: true },
  })
  if (!responsible) {
    throw validationError('Указан несуществующий ответственный', [
      { field: 'responsibleId', message: 'Сотрудник не найден' },
    ])
  }
  if (!canBeResponsible(responsible.role)) {
    throw validationError('Этого пользователя нельзя назначить ответственным', [
      {
        field: 'responsibleId',
        message: 'Ответственным может быть только менеджер или администратор ИТ-Школы',
      },
    ])
  }
}

/**
 * Участники встречи — из того же вуза, что и встреча.
 *
 * Контактное лицо — вуза встречи. Сотрудник ИТ-Школы — любой действующий;
 * представитель вуза — только своего. Битая ссылка в составе встречи хуже
 * её отсутствия, поэтому несуществующие тоже отклоняются.
 */
export async function assertParticipantsBelong(
  universityId: string | null,
  participants: ReadonlyArray<{ userId?: string | null; contactId?: string | null }>,
): Promise<void> {
  const userIds = participants.flatMap((participant) => (participant.userId ? [participant.userId] : []))
  const contactIds = participants.flatMap((participant) =>
    participant.contactId ? [participant.contactId] : [],
  )

  if (userIds.length > 0) {
    const found = await prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true, role: true, universityId: true },
    })
    const wrong = userIds.filter((id) => {
      const user = found.find((candidate) => candidate.id === id)
      if (!user) return true
      return user.role === 'UNIVERSITY_REP' && user.universityId !== universityId
    })
    if (wrong.length > 0) {
      throw validationError('Указаны сотрудники не из этой встречи', [
        {
          field: 'participants',
          message: `Не найдены или представляют другой вуз: ${wrong.join(', ')}`,
        },
      ])
    }
  }

  if (contactIds.length > 0) {
    const found = await prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, universityId: true },
    })
    const wrong = contactIds.filter((id) => {
      const contact = found.find((candidate) => candidate.id === id)
      return !contact || contact.universityId !== universityId
    })
    if (wrong.length > 0) {
      throw validationError('Указаны контактные лица другого вуза', [
        { field: 'participants', message: `Не найдены в вузе встречи: ${wrong.join(', ')}` },
      ])
    }
  }
}
