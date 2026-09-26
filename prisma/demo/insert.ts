/**
 * Запись расширенного демо-набора в базу (решение 131): пакетами createMany,
 * с заранее известными идентификаторами — без похода в базу на каждую запись.
 * Заливка всего набора — секунды, а не минуты: сид на стенде идёт через reseed.sh.
 *
 * Журнал действий пишется теми же действиями и с тем же содержимым, что пишет
 * работающая система, обычным INSERT и в хронологическом порядке.
 */

import type { Prisma, PrismaClient } from '../../src/generated/prisma/client'
import { BASE_PRODUCT_KEYS, REGIONAL_SOURCE, type BaseProductKey } from './catalog'
import type { DemoCooperation, DemoData } from './generate'
import { demoId } from './random'

/** Пакет createMany: PostgreSQL держит до 65 535 параметров в запросе. */
const BATCH = 1000

async function inBatches<T>(rows: readonly T[], write: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let index = 0; index < rows.length; index += BATCH) {
    await write(rows.slice(index, index + BATCH))
  }
}

export interface ExtendedSeedContext {
  users: { manager: { id: string }; manager2: { id: string } }
  /** id навыка основного сида по имени. */
  baseSkillId: (name: string) => string
  /** id продуктов основного сида по ключу seedProducts. */
  baseProducts: Record<BaseProductKey, { id: string }>
  /** id вуза основного сида по ключу (для программ ТУСУР). */
  baseUniversityId: (key: string) => string
  mockSource: { id: string; name: string }
}

export interface ExtendedSeedResult {
  cooperationId: (key: string) => string
  counts: Record<string, number>
}

type AuditRow = Prisma.AuditLogCreateManyInput

/** Расширенный демо-набор целиком: навыки, рынок, продукты, вузы, программы, связки. */
export async function insertExtendedDemo(
  prisma: PrismaClient,
  data: DemoData,
  context: ExtendedSeedContext,
): Promise<ExtendedSeedResult> {
  const audit: AuditRow[] = []
  const userOf = (who: 'manager' | 'manager2') => context.users[who].id
  const colleagueOf = (who: 'manager' | 'manager2') => context.users[who === 'manager' ? 'manager2' : 'manager'].id

  // ── Навыки ──
  const extraSkillIds = new Map(data.skills.map((skill) => [skill.name, demoId('skill', skill.name)]))
  await prisma.skill.createMany({
    data: data.skills.map((skill) => ({ id: extraSkillIds.get(skill.name)!, ...skill })),
  })
  const skillId = (name: string) => extraSkillIds.get(name) ?? context.baseSkillId(name)

  // ── Рынок: новые навыки, период 2026-Q2 и выгрузка по регионам ──
  const regionalSource = await prisma.dataSource.create({
    data: {
      name: REGIONAL_SOURCE.name,
      type: 'CSV',
      collectionDate: new Date(data.anchor.getTime() - 20 * 24 * 60 * 60 * 1000),
      reliability: 'LOW',
      description: REGIONAL_SOURCE.description,
      isMock: true,
    },
  })
  await prisma.marketDemand.createMany({
    data: data.market.map((row) => ({
      skillId: skillId(row.skill),
      period: row.period,
      value: row.value,
      unit: 'вакансий',
      region: row.region,
      source: row.source === 'base' ? context.mockSource.name : REGIONAL_SOURCE.name,
      dataSourceId: row.source === 'base' ? context.mockSource.id : regionalSource.id,
      confidence: 'LOW' as const,
      isMock: true,
    })),
  })

  // ── Продукты ──
  const productIds = new Map<string, string>()
  for (const key of BASE_PRODUCT_KEYS) productIds.set(key, context.baseProducts[key].id)
  for (const product of data.products) productIds.set(product.key, demoId('product', product.key))
  await prisma.iTProduct.createMany({
    data: data.products.map((product) => ({
      id: productIds.get(product.key)!,
      name: product.name,
      category: product.category,
      description: product.description,
      documentationUrl: product.status === 'PLANNED' ? null : `https://example.invalid/docs/${product.key}`,
      version: product.version,
      status: product.status,
      isMock: true,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    })),
  })
  await prisma.productSkill.createMany({
    data: data.products.flatMap((product) =>
      product.skills.map(([name, relevance]) => ({
        productId: productIds.get(product.key)!,
        skillId: skillId(name),
        relevance,
        createdAt: product.createdAt,
      })),
    ),
  })
  const productId = (key: string | null) => {
    if (key === null) return null
    const id = productIds.get(key)
    if (!id) throw new Error(`Продукт не найден: ${key}`)
    return id
  }

  // ── Вузы и контакты ──
  const universityIds = new Map(data.universities.map((university) => [university.key, demoId('university', university.key)]))
  const universityId = (key: string) => universityIds.get(key) ?? context.baseUniversityId(key)
  await prisma.university.createMany({
    data: data.universities.map((university) => ({
      id: universityIds.get(university.key)!,
      name: university.name,
      shortName: university.shortName,
      city: university.city,
      region: university.region,
      address: `${university.city}, адрес указан условно`,
      website: `https://example.invalid/${university.key}`,
      status: university.status,
      archivedAt: university.archivedAt,
      directionCount: university.directionCount,
      studentCount: university.studentCount,
      description: 'Демонстрационная запись. Показатели не являются подтверждённой статистикой.',
      isMock: true,
      createdAt: university.createdAt,
      updatedAt: university.updatedAt,
    })),
  })
  const contacts = data.universities.flatMap((university) =>
    university.contacts.map((contact) => ({ university, contact, id: demoId('contact', contact.key) })),
  )
  await prisma.contact.createMany({
    data: contacts.map(({ university, contact, id }) => ({
      id,
      universityId: universityIds.get(university.key)!,
      fullName: contact.fullName,
      position: contact.position,
      email: contact.email,
      phone: contact.phone,
      isPrimary: contact.isPrimary,
      legalBasis: contact.legalBasis,
      consentStatus: contact.consentStatus,
      consentObtainedAt: contact.consentObtainedAt,
      consentForm: contact.consentForm,
      consentWithdrawnAt: contact.consentWithdrawnAt,
      basisReference: contact.basisReference,
      withdrawalReference: contact.withdrawalReference,
      basisUpdatedAt: contact.basisUpdatedAt,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    })),
  })
  // История оснований — как если бы основание фиксировал менеджер (как в основном сиде).
  await prisma.contactBasisHistory.createMany({
    data: contacts.flatMap(({ contact, id }) =>
      contact.history.map((entry) => ({
        contactId: id,
        fromBasis: entry.fromBasis,
        toBasis: entry.toBasis,
        fromConsentStatus: entry.fromConsentStatus,
        toConsentStatus: entry.toConsentStatus,
        consentObtainedAt: entry.consentObtainedAt,
        consentForm: entry.consentForm,
        consentWithdrawnAt: entry.consentWithdrawnAt,
        referenceChanged: true,
        anonymized: entry.anonymized,
        changedById: context.users.manager.id,
        changedAt: entry.changedAt,
      })),
    ),
  })
  const contactId = (key: string) => demoId('contact', key)

  // ── Программы, навыки программ, заявки ──
  const programIds = new Map(data.programs.map((program) => [program.key, demoId('program', program.key)]))
  await prisma.educationalProgram.createMany({
    data: data.programs.map((program) => {
      const hasMetrics = program.applicationCount !== null || program.studentCount !== null || program.groupCount !== null
      return {
        id: programIds.get(program.key)!,
        universityId: universityId(program.universityKey),
        name: program.name,
        code: program.code,
        direction: program.direction,
        level: program.level,
        durationMonths: program.durationMonths,
        status: program.status,
        archivedAt: program.archivedAt,
        applicationCount: program.applicationCount,
        studentCount: program.studentCount,
        groupCount: program.groupCount,
        metricsSource: hasMetrics ? ('MOCK' as const) : null,
        metricsUpdatedAt: program.metricsUpdatedAt,
        isMock: true,
        createdAt: program.createdAt,
        updatedAt: program.metricsUpdatedAt ?? program.archivedAt ?? program.createdAt,
      }
    }),
  })
  await prisma.programSkill.createMany({
    data: data.programs.flatMap((program) =>
      program.skills.map(([name, level, importance]) => ({
        programId: programIds.get(program.key)!,
        skillId: skillId(name),
        level,
        importance,
        source: 'CURRICULUM' as const,
        confidence: 'MEDIUM' as const,
      })),
    ),
  })
  await prisma.application.createMany({
    data: data.programs.flatMap((program) =>
      program.applications.map((application) => ({
        programId: programIds.get(program.key)!,
        universityId: universityId(program.universityKey),
        source: 'MOCK' as const,
        status: application.status,
        quantity: application.quantity,
        comment: 'Демонстрационный пакет заявок',
        submittedAt: application.submittedAt,
        createdAt: application.submittedAt,
        updatedAt: application.submittedAt,
      })),
    ),
  })
  // applicationCount считается по заявкам (решение 9): расхождение — ошибка набора.
  for (const program of data.programs) {
    const counted = program.applications
      .filter((application) => ['NEW', 'CONFIRMED', 'ENROLLED'].includes(application.status))
      .reduce((sum, application) => sum + application.quantity, 0)
    if ((program.applicationCount ?? 0) !== counted) {
      throw new Error(`Несогласованные демо-данные по программе ${program.key}: показатель ${program.applicationCount}, заявок ${counted}`)
    }
  }
  const programId = (key: string) => {
    const id = programIds.get(key)
    if (!id) throw new Error(`Программа не найдена: ${key}`)
    return id
  }

  // ── Связки ──
  const cooperationIds = new Map(data.cooperations.map((coop) => [coop.key, demoId('cooperation', coop.key)]))
  const cooperationRows: Prisma.CooperationCreateManyInput[] = []
  const stageRows: Prisma.WorkflowStageCreateManyInput[] = []
  const taskRows: Prisma.TaskCreateManyInput[] = []
  const historyRows: Prisma.StageHistoryCreateManyInput[] = []
  const documentRows: Prisma.DocumentCreateManyInput[] = []
  const documentHistoryRows: Prisma.DocumentHistoryCreateManyInput[] = []
  const meetingRows: Prisma.MeetingCreateManyInput[] = []
  const participantRows: Prisma.MeetingParticipantCreateManyInput[] = []

  for (const coop of data.cooperations) {
    const id = cooperationIds.get(coop.key)!
    const responsibleId = userOf(coop.responsible)
    const university = universityId(coop.universityKey)
    const program = programId(coop.programKey)
    cooperationRows.push({
      id,
      universityId: university,
      programId: program,
      productId: productId(coop.productKey),
      responsibleId,
      status: coop.status,
      goal: coop.goal,
      notes: coop.notes,
      firstContactAt: coop.firstContactAt,
      classesStartAt: coop.classesStartAt,
      targetDate: coop.targetDate,
      startedAt: coop.startedAt,
      closedAt: coop.closedAt,
      isMock: true,
      // Время записи — по сюжету (решение 56): заведена в начале работы, закрытая — в день закрытия.
      createdAt: coop.startedAt,
      updatedAt: coop.closedAt ?? coop.startedAt,
    })
    audit.push({ userId: responsibleId, action: 'cooperation.create', objectType: 'Cooperation', objectId: id, payload: { status: coop.status === 'DRAFT' ? 'DRAFT' : 'ACTIVE' }, createdAt: coop.startedAt })
    for (const change of cooperationStatusChanges(coop)) {
      audit.push({ userId: responsibleId, action: 'cooperation.update', objectType: 'Cooperation', objectId: id, payload: { status: change.status }, createdAt: change.at })
    }

    for (const stage of coop.stages) {
      const stageId = demoId('stage', `${coop.key}:${stage.number}`)
      const isControl = stage.number === 14
      stageRows.push({
        id: stageId,
        cooperationId: id,
        stageNumber: stage.number,
        title: stage.title,
        phase: stage.phase,
        status: stage.status,
        responsibleId,
        deadline: stage.deadline,
        startedAt: stage.startedAt,
        completedAt: stage.completedAt,
        completedById: stage.status === 'COMPLETED' && !isControl ? responsibleId : null,
        result: stage.result,
        comment: stage.comment,
        blockingReason: stage.blockingReason,
        createdAt: coop.startedAt,
        updatedAt: stage.history.at(-1)?.changedAt ?? coop.startedAt,
      })
      stage.tasks.forEach((task, index) => {
        const taskId = demoId('task', `${coop.key}:${stage.number}:${index}`)
        taskRows.push({
          id: taskId,
          stageId,
          title: task.title,
          isRequired: task.isRequired,
          isUniversityItem: task.isUniversityItem,
          sortOrder: task.sortOrder,
          isDone: task.isDone,
          doneAt: task.doneAt,
          doneById: task.isDone ? responsibleId : null,
          confirmationNote: task.confirmationNote,
          createdAt: coop.startedAt,
          updatedAt: task.doneAt ?? coop.startedAt,
        })
        // Отметка за вуз сотрудником — отдельное действие без текста пометки (решение 103).
        if (task.isDone && task.isUniversityItem && task.confirmationNote && task.doneAt) {
          audit.push({
            userId: responsibleId, action: 'task.university-item.confirm-by-staff', objectType: 'Task', objectId: taskId,
            payload: { stageNumber: stage.number, noteLength: task.confirmationNote.length }, createdAt: task.doneAt,
          })
        }
      })
      for (const entry of stage.history) {
        historyRows.push({
          stageId,
          fromStatus: entry.fromStatus,
          toStatus: entry.toStatus,
          comment: entry.comment,
          changedById: responsibleId,
          changedAt: entry.changedAt,
        })
        audit.push({
          userId: responsibleId, action: 'stage.status.change', objectType: 'WorkflowStage', objectId: stageId,
          payload: { from: entry.fromStatus, to: entry.toStatus, stageNumber: stage.number }, createdAt: entry.changedAt,
        })
      }
    }

    for (const document of coop.documents) {
      const documentId = demoId('document', document.key)
      documentRows.push({
        id: documentId,
        cooperationId: id,
        universityId: university,
        programId: program,
        type: document.type,
        title: document.title,
        version: document.version,
        status: document.status,
        fileReference: `https://example.invalid/docs/${coop.key}/${document.type.toLowerCase()}-${document.version}.pdf`,
        authorId: responsibleId,
        responsibleId,
        issuedAt: document.issuedAt,
        signedAt: document.signedAt,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })
      audit.push({ userId: responsibleId, action: 'document.create', objectType: 'Document', objectId: documentId, payload: { type: document.type, cooperationId: id }, createdAt: document.createdAt })
      for (const step of document.history) {
        documentHistoryRows.push({
          documentId,
          fromStatus: step.fromStatus,
          toStatus: step.toStatus,
          comment: step.comment,
          changedById: responsibleId,
          changedAt: step.changedAt,
        })
        audit.push({ userId: responsibleId, action: 'document.status.change', objectType: 'Document', objectId: documentId, payload: { from: step.fromStatus, to: step.toStatus }, createdAt: step.changedAt })
      }
    }

    for (const meeting of coop.meetings) {
      const meetingId = demoId('meeting', meeting.key)
      meetingRows.push({
        id: meetingId,
        cooperationId: id,
        universityId: university,
        programId: program,
        date: meeting.date,
        topic: meeting.topic,
        format: meeting.format,
        result: meeting.result,
        nextAction: meeting.nextAction,
        nextActionDueAt: meeting.nextActionDueAt,
        responsibleId,
        createdAt: meeting.createdAt,
        updatedAt: meeting.createdAt,
      })
      for (const participant of meeting.participants) {
        participantRows.push({
          meetingId,
          userId: participant.kind === 'responsible' ? responsibleId : participant.kind === 'colleague' ? colleagueOf(coop.responsible) : null,
          contactId: participant.kind === 'contact' ? contactId(participant.contactKey) : null,
          createdAt: meeting.createdAt,
        })
      }
      audit.push({ userId: responsibleId, action: 'meeting.create', objectType: 'Meeting', objectId: meetingId, payload: { cooperationId: id, participants: meeting.participants.length }, createdAt: meeting.createdAt })
    }
  }

  // Встречи с вузами без связки: всплеск спроса на киберполигон за последнюю неделю.
  const basePrimary = new Map(
    (
      await prisma.contact.findMany({
        where: { isPrimary: true, universityId: { notIn: [...universityIds.values()] } },
        select: { id: true, universityId: true },
      })
    ).map((row) => [row.universityId, row.id]),
  )
  for (const meeting of data.universityMeetings) {
    const meetingId = demoId('meeting', meeting.key)
    const responsibleId = userOf(meeting.responsible)
    const university = universityId(meeting.universityKey)
    const contact = meeting.contactKey ? contactId(meeting.contactKey) : (basePrimary.get(university) ?? null)
    meetingRows.push({
      id: meetingId,
      cooperationId: null,
      universityId: university,
      programId: null,
      date: meeting.date,
      topic: meeting.topic,
      format: meeting.format,
      result: meeting.result,
      nextAction: meeting.nextAction,
      nextActionDueAt: meeting.nextActionDueAt,
      responsibleId,
      createdAt: meeting.date,
      updatedAt: meeting.date,
    })
    participantRows.push({ meetingId, userId: responsibleId, createdAt: meeting.date })
    if (contact) participantRows.push({ meetingId, contactId: contact, createdAt: meeting.date })
    audit.push({
      userId: responsibleId, action: 'meeting.create', objectType: 'Meeting', objectId: meetingId,
      payload: { cooperationId: null, participants: contact ? 2 : 1 }, createdAt: meeting.date,
    })
  }

  await prisma.cooperation.createMany({ data: cooperationRows })
  await inBatches(stageRows, (batch) => prisma.workflowStage.createMany({ data: batch }))
  await inBatches(taskRows, (batch) => prisma.task.createMany({ data: batch }))
  await inBatches(historyRows, (batch) => prisma.stageHistory.createMany({ data: batch }))
  await inBatches(documentRows, (batch) => prisma.document.createMany({ data: batch }))
  await inBatches(documentHistoryRows, (batch) => prisma.documentHistory.createMany({ data: batch }))
  await inBatches(meetingRows, (batch) => prisma.meeting.createMany({ data: batch }))
  await inBatches(participantRows, (batch) => prisma.meetingParticipant.createMany({ data: batch }))

  // Журнал — одним потоком в порядке времени, обычным INSERT (цепочка журнала, решение 115).
  audit.sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime())
  await inBatches(audit, (batch) => prisma.auditLog.createMany({ data: batch }))

  const cooperationId = (key: string) => {
    const id = cooperationIds.get(key)
    if (!id) throw new Error(`Связка не найдена: ${key}`)
    return id
  }
  return {
    cooperationId,
    counts: {
      universities: data.universities.length,
      programs: data.programs.length,
      products: data.products.length,
      cooperations: cooperationRows.length,
      stageHistory: historyRows.length,
      documents: documentRows.length,
      meetings: meetingRows.length,
      audit: audit.length,
    },
  }
}

/** Смены статуса связки после создания: пауза, отмена, завершение. */
function cooperationStatusChanges(coop: DemoCooperation): Array<{ status: string; at: Date }> {
  if (coop.status === 'CANCELLED' && coop.closedAt) return [{ status: 'CANCELLED', at: coop.closedAt }]
  if (coop.status === 'COMPLETED' && coop.closedAt) return [{ status: 'COMPLETED', at: coop.closedAt }]
  if (coop.status === 'PAUSED') {
    const pauseLetter = coop.meetings.find((meeting) => meeting.topic.startsWith('Письмо вуза о паузе'))
    const lastLeave = coop.stages.reduce<Date>((latest, stage) => (stage.completedAt && stage.completedAt > latest ? stage.completedAt : latest), coop.startedAt)
    return [{ status: 'PAUSED', at: pauseLetter?.date ?? lastLeave }]
  }
  return []
}

/**
 * Рекомендации после движка правил: закрытые из прошлого (DONE, DISMISSED) и
 * решения людей по свежим — «в работе» и «отклонена» у связки на паузе.
 * Пара «правило — объект» уникальна: если движок уже выдал свою, прошлая не пишется.
 */
export async function insertResolvedRecommendations(
  prisma: PrismaClient,
  data: DemoData,
  context: { manager: { id: string }; cooperationId: (key: string) => string },
): Promise<number> {
  const existing = await prisma.recommendation.findMany({ select: { id: true, ruleKey: true, objectType: true, objectId: true, status: true } })
  const taken = new Set(existing.map((row) => `${row.ruleKey}::${row.objectType}::${row.objectId}`))
  const audit: AuditRow[] = []
  const rows: Prisma.RecommendationCreateManyInput[] = []

  for (const item of data.resolvedRecommendations) {
    const objectId =
      item.objectType === 'Cooperation' ? context.cooperationId(item.cooperationKey!) : demoId('program', item.programKey!)
    if (taken.has(`${item.ruleKey}::${item.objectType}::${objectId}`)) continue
    const id = demoId('recommendation', item.key)
    rows.push({
      id,
      type: item.type,
      objectType: item.objectType,
      objectId,
      ruleKey: item.ruleKey,
      title: item.title,
      description: item.description,
      justification: item.justification,
      priority: item.priority,
      confidence: 'HIGH',
      status: item.status,
      relatedData: item.objectType === 'EducationalProgram' ? { ...item.relatedData, programId: objectId } : (item.relatedData as Prisma.InputJsonValue),
      resolutionComment: item.resolutionComment,
      cooperationId: item.objectType === 'Cooperation' ? objectId : null,
      resolvedById: context.manager.id,
      resolvedAt: item.resolvedAt,
      createdAt: item.createdAt,
      updatedAt: item.resolvedAt,
    })
    audit.push({
      userId: context.manager.id, action: 'recommendation.status.change', objectType: 'Recommendation', objectId: id,
      payload: { from: 'NEW', to: item.status, ruleKey: item.ruleKey }, createdAt: item.resolvedAt,
    })
  }
  await prisma.recommendation.createMany({ data: rows })

  // Решения по свежим рекомендациям движка — как их приняли бы люди.
  const decisions: Array<{ coop: string; ruleKey: string; to: 'IN_PROGRESS' | 'DISMISSED'; comment?: string; daysAgo: number }> = [
    { coop: 'sfu-networks', ruleKey: 'cooperation.no-product', to: 'IN_PROGRESS', daysAgo: 1 },
    { coop: 'sfu-soft', ruleKey: 'cooperation.stalled', to: 'IN_PROGRESS', daysAgo: 2 },
    { coop: 'dvfu-soft', ruleKey: 'cooperation.stalled', to: 'DISMISSED', comment: 'Пауза по просьбе вуза: сменилось руководство института. Вернёмся в ноябре.', daysAgo: 4 },
  ]
  for (const decision of decisions) {
    const row = await prisma.recommendation.findFirst({
      where: { ruleKey: decision.ruleKey, objectType: 'Cooperation', objectId: context.cooperationId(decision.coop), status: 'NEW' },
    })
    if (!row) continue
    const at = new Date(data.anchor.getTime() - decision.daysAgo * 24 * 60 * 60 * 1000)
    await prisma.recommendation.update({
      where: { id: row.id },
      data:
        decision.to === 'DISMISSED'
          ? { status: 'DISMISSED', resolutionComment: decision.comment ?? null, resolvedById: context.manager.id, resolvedAt: at, updatedAt: at }
          : { status: 'IN_PROGRESS', updatedAt: at },
    })
    audit.push({
      userId: context.manager.id, action: 'recommendation.status.change', objectType: 'Recommendation', objectId: row.id,
      payload: { from: 'NEW', to: decision.to, ruleKey: row.ruleKey }, createdAt: at,
    })
  }

  audit.sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime())
  await prisma.auditLog.createMany({ data: audit })
  return rows.length
}
