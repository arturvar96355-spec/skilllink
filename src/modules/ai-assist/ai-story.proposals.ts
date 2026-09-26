import { randomUUID } from 'node:crypto'
import { AI_PROPOSAL } from '@/shared/config/ai-assist.config'
import type { AiDraftSource } from '@/shared/contracts/ai-assist'
import type { AiProposalDto, AiProposalKind, AiProposalPayload, AiStorySource } from '@/shared/contracts/ai-story'

/**
 * Проекты «Предложить план» (решение 138) — в памяти процесса, не в базе.
 *
 * Проект ничего не меняет в данных: это черновик, который человек либо сохраняет
 * (тогда штатный сервис встреч или этапов создаёт настоящую запись), либо отменяет.
 * Как счётчики лимита ИИ-помощника (`ai-assist.limits.ts`) — переживать перезапуск
 * приложения ему не нужно: живёт он час (`AI_PROPOSAL.ttlMs`), а «отменить» и так
 * значит «ничего не делать». Хранить его в таблице означало бы вести миграцию
 * и запись в базу ради данных, которые в 99% случаев удаляются сами по истечении часа.
 */

export interface StoredProposal {
  proposalId: string
  cooperationId: string
  kind: AiProposalKind
  payload: AiProposalPayload
  /** `updatedAt` связки на момент постройки проекта — проверяется перед применением. */
  sourceVersion: string
  createdAt: string
  expiresAt: number
  warnings: string[]
  source: AiStorySource
  provider: Exclude<AiDraftSource, 'template'> | null
  model: string | null
}

const store = new Map<string, StoredProposal>()

export interface NewProposal {
  cooperationId: string
  kind: AiProposalKind
  payload: AiProposalPayload
  sourceVersion: string
  warnings: string[]
  source: AiStorySource
  provider: Exclude<AiDraftSource, 'template'> | null
  model: string | null
}

export function saveProposal(input: NewProposal, now: number): StoredProposal {
  const proposalId = randomUUID()
  const record: StoredProposal = {
    ...input,
    proposalId,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + AI_PROPOSAL.ttlMs,
  }

  // Переполнение — вытесняются самые старые записи, как в кэше ИИ-помощника.
  while (store.size >= AI_PROPOSAL.maxStored) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
  store.set(proposalId, record)
  return record
}

/** `null` — проекта нет или он истёк (запись при этом удаляется). */
export function findProposal(proposalId: string, now: number): StoredProposal | null {
  const record = store.get(proposalId)
  if (!record) return null
  if (record.expiresAt <= now) {
    store.delete(proposalId)
    return null
  }
  return record
}

/** Проект одноразовый: применили — записи больше нет. */
export function consumeProposal(proposalId: string): void {
  store.delete(proposalId)
}

export function toProposalDto(record: StoredProposal): AiProposalDto {
  return {
    proposalId: record.proposalId,
    kind: record.kind,
    cooperationId: record.cooperationId,
    payload: record.payload,
    sourceVersion: record.sourceVersion,
    createdAt: record.createdAt,
    expiresAt: new Date(record.expiresAt).toISOString(),
    warnings: record.warnings,
    source: record.source,
    provider: record.provider,
    model: record.model,
  }
}

/** Только для тестов: состояние процесса между ними протекать не должно. */
export function resetAiProposals(): void {
  store.clear()
}
