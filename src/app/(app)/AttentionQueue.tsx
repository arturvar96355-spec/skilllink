'use client'

import { useState, type HTMLAttributes } from 'react'
import type { ProblemCooperationDto, ProblemGroupsDto } from '@/shared/contracts'
import {
  Button,
  Queue,
  QueueFoot,
  QueueFootLink,
  QueueGroup,
  QueueRow,
  cooperationHref,
  formatPersonShort,
  initials,
  overdueValue,
  queueRowLabel,
  stageNotation,
  startMorph,
  toneOfSeverity,
} from '@/ui'
import { attentionGroups, attentionHidden } from './attention-queue'
import { StageActionModal } from './StageActionModal'
import { StageDeadlineModal } from './StageDeadlineModal'

/**
 * «Требует внимания» — очередь по серьёзности (решение 206, вариант A).
 *
 * Три группы с числами по всем проблемным этапам, строки — показанные.
 * У строки одно действие: у просроченного — «Изменить срок», у заблокированного —
 * «Снять блокировку»; окна те же, что в карточке связки. Эксперт (только чтение)
 * кнопок не видит — щелчок по строке открывает этап.
 */
export function AttentionQueue({
  rows,
  groups,
  canWrite,
  onChanged,
  itemProps,
}: {
  rows: ProblemCooperationDto[]
  groups: ProblemGroupsDto
  canWrite: boolean
  /** Этап изменён — главная перечитывает сводку: строка могла уйти из очереди. */
  onChanged: () => void
  /** Всплывающая карточка связки в презентационном режиме. */
  itemProps?: (row: ProblemCooperationDto) => HTMLAttributes<HTMLLIElement>
}) {
  const [editing, setEditing] = useState<{ row: ProblemCooperationDto; kind: 'deadline' | 'unblock' } | null>(null)
  const hidden = attentionHidden(rows, groups)

  function close(changed: boolean) {
    setEditing(null)
    if (changed) onChanged()
  }

  return (
    <>
      <Queue>
        {attentionGroups(rows, groups).map((group) => (
          <QueueGroup key={group.key} label={group.label} count={group.count}>
            {group.rows.map((row) => {
              const title = `${row.universityShortName ?? row.universityName} — ${row.programName}`
              const isBlocked = row.severity === 'blocked'
              const value = overdueValue(row.daysOverdue)
              const owner = row.responsible ? formatPersonShort(row.responsible.fullName) : 'ответственный не назначен'
              const state = isBlocked
                ? `заблокирован${row.blockingReason ? `: ${row.blockingReason}` : ''}`
                : row.daysOverdue && row.daysOverdue > 0
                  ? `просрочен на ${row.daysOverdue} дн.`
                  : 'срок вышел сегодня'
              const canAct = canWrite && row.stageId !== null && row.stageNumber !== null
              return (
                <QueueRow
                  key={`${row.cooperationId}:${row.stageId ?? row.reason}`}
                  tone={toneOfSeverity(row.severity)}
                  title={title}
                  meta={{
                    notation: row.stageNumber !== null ? stageNotation(row.stageNumber) : undefined,
                    // У блокировки важнее причина, чем название этапа: она и говорит, что делать.
                    text: (isBlocked ? row.blockingReason : null) ?? row.stageTitle ?? undefined,
                    tail: owner,
                    tailShort: row.responsible ? initials(row.responsible.fullName) : 'не назначен',
                    tailTitle: row.responsible ? `Ответственный: ${row.responsible.fullName}` : undefined,
                  }}
                  value={value}
                  label={queueRowLabel([
                    title,
                    row.stageNumber !== null ? `этап ${row.stageNumber} «${row.stageTitle ?? ''}»` : null,
                    state,
                    row.responsible ? `ответственный ${row.responsible.fullName}` : 'ответственный не назначен',
                    'Открыть этап',
                  ])}
                  href={cooperationHref(row.cooperationId, row.stageId)}
                  onNavigate={(event) => startMorph(event.currentTarget, event)}
                  itemProps={itemProps?.(row)}
                  action={
                    canAct ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={isBlocked ? 'play' : 'calendar'}
                        aria-label={`${isBlocked ? 'Снять блокировку' : 'Изменить срок'}: ${title}, этап ${row.stageNumber}`}
                        onClick={() => setEditing({ row, kind: isBlocked ? 'unblock' : 'deadline' })}
                      >
                        {isBlocked ? 'Снять блокировку' : 'Изменить срок'}
                      </Button>
                    ) : undefined
                  }
                />
              )
            })}
          </QueueGroup>
        ))}
        {hidden && (
          <QueueFoot>
            <span>{hidden.text}</span>
            <QueueFootLink href={hidden.href}>В реестре связок</QueueFootLink>
          </QueueFoot>
        )}
      </Queue>

      {editing?.kind === 'deadline' && editing.row.stageId && editing.row.stageNumber !== null && (
        <StageDeadlineModal
          stage={{
            id: editing.row.stageId,
            stageNumber: editing.row.stageNumber,
            title: editing.row.stageTitle ?? '',
            deadline: editing.row.deadline,
          }}
          onClose={(updated) => close(updated !== null)}
        />
      )}
      {editing?.kind === 'unblock' && editing.row.stageId && editing.row.stageNumber !== null && (
        <StageActionModal
          stage={{
            id: editing.row.stageId,
            stageNumber: editing.row.stageNumber,
            title: editing.row.stageTitle ?? undefined,
          }}
          kind="unblock"
          onClose={(updated) => close(updated !== null)}
        />
      )}
    </>
  )
}
