'use client'

import { useState } from 'react'
import {
  CONSENT_FORMS,
  CONSENT_FORM_LABELS,
  CONSENT_STATUS_LABELS,
  CONTACT_LEGAL_BASES,
  CONTACT_LEGAL_BASIS_LABELS,
  type ConsentForm,
  type ContactBasisHistoryEntryDto,
  type ContactDto,
  type ContactLegalBasis,
  type ContactRevealDto,
} from '@/shared/contracts'
import {
  Avatar,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Select,
  Textarea,
  apiPost,
  apiPut,
  buildQuery,
  dateInputToIso,
  fieldErrors,
  formatDate,
  formatDateTime,
  isoToDateInput,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import styles from './university.module.css'

/**
 * Блок контактов карточки вуза (решение 181): маска почты и телефона с раскрытием
 * по причине (решение 133), правовое основание обработки ПД и согласие (решение 111)
 * и удаление персональных данных по запросу (уже было). Один блок — так проще
 * не растащить связанные действия над контактом по разным местам страницы.
 *
 * Права приходят с сервера в самом контакте (`legalBasis`, `contactDetailsHidden`)
 * и в `/api/me` (`canWrite`, `canSeeContactDetails`): фронт только показывает то,
 * что сервер разрешит. Учётная запись эксперта хакатона видит те же данные —
 * `canWrite` для неё уже `false`, кнопки правки сами не рисуются.
 */

const BASIS_OPTIONS = CONTACT_LEGAL_BASES.map((value) => ({ value, label: CONTACT_LEGAL_BASIS_LABELS[value] }))
const CONSENT_FORM_OPTIONS = CONSENT_FORMS.map((value) => ({ value, label: CONSENT_FORM_LABELS[value] }))

function detailFor(error: unknown, field: string): string | null {
  return fieldErrors(error).find((item) => item.field === field)?.message ?? null
}

// ─────────────────────────── Раскрытие почты и телефона ───────────────────────────

/**
 * Идентификатор контакта нигде в разметке не показан (описания и подсказки
 * прячут id по правилу дизайн-системы), но он же нужен, чтобы зарегистрировать
 * запрос субъекта ПД на этот контакт («Настройки → Запросы субъектов», решение 181):
 * своего поиска контактов по ФИО там нет. Кнопка — только тем, кто и создаёт
 * такие запросы (ADMIN, право DSAR_MANAGE).
 */
function CopyContactIdButton({ contact }: { contact: ContactDto }) {
  const toast = useToast()

  async function copy() {
    try {
      await navigator.clipboard.writeText(contact.id)
      toast.success('Идентификатор контакта скопирован')
    } catch {
      toast.info(`Скопировать не удалось — идентификатор: ${contact.id}`)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={copy}
      title="Для запроса субъекта ПД («Настройки → Запросы субъектов»)"
    >
      Скопировать id
    </Button>
  )
}

function RevealAction({ contact }: { contact: ContactDto }) {
  const toast = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [revealed, setRevealed] = useState<ContactRevealDto | null>(null)

  const reveal = useMutation(async (input: { reason: string }) => {
    const result = await apiPost<ContactRevealDto>(`/api/contacts/${contact.id}/reveal`, { reason: input.reason })
    return result.data
  })

  async function submit() {
    const result = await reveal.run({ reason: reason.trim() })
    if (!result.ok) return
    setRevealed(result.data)
    setIsOpen(false)
    setReason('')
    toast.success('Почта и телефон раскрыты. Раскрытие записано в журнал действий.')
  }

  if (revealed) {
    return (
      <span className={styles.contactLinks}>
        {revealed.email && (
          <a className={styles.factLink} href={`mailto:${revealed.email}`}>
            {revealed.email}
          </a>
        )}
        {revealed.phone && <span className={styles.rowMeta}>{revealed.phone}</span>}
        <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>
          Скрыть
        </Button>
      </span>
    )
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setIsOpen(true)}>
        Показать
      </Button>
      {isOpen && (
        <Modal
          isOpen
          onClose={() => setIsOpen(false)}
          title="Показать почту и телефон"
          description={`Контакт: ${contact.fullName}. Раскрытие записывается в журнал действий с указанной причиной.`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setIsOpen(false)}>
                Отмена
              </Button>
              <Button variant="primary" onClick={submit} isLoading={reveal.isPending} disabled={reason.trim().length < 10}>
                Показать
              </Button>
            </>
          }
        >
          <Textarea
            label="Причина"
            required
            placeholder="Например: уточнить дату встречи по телефону"
            hint="Не короче 10 символов — журнал должен объяснять, зачем раскрыты данные"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={detailFor(reveal.error, 'reason')}
          />
        </Modal>
      )}
    </>
  )
}

// ─────────────────────── Правовое основание и согласие контакта ───────────────────────

function EditBasisModal({
  contact,
  universityId,
  onClose,
  onChanged,
}: {
  contact: ContactDto
  universityId: string
  onClose: () => void
  onChanged: (contact: ContactDto) => void
}) {
  const current = contact.legalBasis
  const [basis, setBasis] = useState<ContactLegalBasis>(current?.basis ?? 'LEGITIMATE_INTEREST')
  const [documentReference, setDocumentReference] = useState(current?.documentReference ?? '')
  const [consentObtainedAt, setConsentObtainedAt] = useState(isoToDateInput(current?.consentObtainedAt))
  const [consentForm, setConsentForm] = useState<ConsentForm | ''>(current?.consentForm ?? '')
  const [consentContext, setConsentContext] = useState(current?.consentContext ?? '')

  const save = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPut<ContactDto>(
      `/api/universities/${universityId}/contacts/${contact.id}/legal-basis`,
      body,
    )
    return result.data
  })

  const isConsent = basis === 'CONSENT'

  async function submit() {
    const result = await save.run({
      basis,
      documentReference: documentReference.trim(),
      consentObtainedAt: isConsent ? dateInputToIso(consentObtainedAt) : null,
      consentForm: isConsent && consentForm !== '' ? consentForm : null,
      consentContext: isConsent && consentContext.trim() !== '' ? consentContext.trim() : null,
    })
    if (!result.ok) return
    onChanged(result.data)
    onClose()
  }

  const error = save.error
  const generalError =
    error && fieldErrors(error).length === 0 ? error.message : null

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Правовое основание обработки ПД"
      description={`Контакт: ${contact.fullName}. Основание фиксируется по документу — файл не загружается, только ссылка на него.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={save.isPending}>
            Сохранить
          </Button>
        </>
      }
    >
      <Select
        label="Основание"
        required
        value={basis}
        onValueChange={(value) => setBasis(value as ContactLegalBasis)}
        options={BASIS_OPTIONS}
        error={detailFor(error, 'basis')}
      />
      <Input
        label="Документ-основание"
        required
        placeholder="Соглашение № 14/2026 от 01.09.2026, архив договоров"
        hint="Номер, дата и где хранится. Сам файл не загружается"
        value={documentReference}
        onChange={(event) => setDocumentReference(event.target.value)}
        error={detailFor(error, 'documentReference')}
      />
      {isConsent && (
        <>
          <Input
            label="Дата получения согласия"
            required
            type="date"
            value={consentObtainedAt}
            onChange={(event) => setConsentObtainedAt(event.target.value)}
            error={detailFor(error, 'consentObtainedAt')}
          />
          <Select
            label="Форма согласия"
            required
            placeholder="Выберите форму"
            value={consentForm}
            onValueChange={(value) => setConsentForm(value as ConsentForm)}
            options={CONSENT_FORM_OPTIONS}
            error={detailFor(error, 'consentForm')}
          />
          <Input
            label="Где получено согласие"
            placeholder="Например: встреча в вузе 12.09.2026"
            hint="Без ФИО — только обстоятельства получения"
            value={consentContext}
            onChange={(event) => setConsentContext(event.target.value)}
            error={detailFor(error, 'consentContext')}
          />
        </>
      )}
      {generalError && <p className={styles.rowMeta}>{generalError}</p>}
    </Modal>
  )
}

function WithdrawConsentModal({
  contact,
  universityId,
  onClose,
  onChanged,
}: {
  contact: ContactDto
  universityId: string
  onClose: () => void
  onChanged: (contact: ContactDto) => void
}) {
  const [withdrawalReference, setWithdrawalReference] = useState('')
  const toast = useToast()

  const withdraw = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPost<ContactDto>(
      `/api/universities/${universityId}/contacts/${contact.id}/consent/withdraw`,
      body,
    )
    return result.data
  })

  async function submit() {
    const result = await withdraw.run({ withdrawalReference: withdrawalReference.trim() })
    if (!result.ok) return
    toast.success('Согласие отозвано. Согласие было единственным основанием — контакт обезличен.')
    onChanged(result.data)
    onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop={false}
      title="Отозвать согласие"
      description={`Контакт: ${contact.fullName}. Необратимо: согласие — единственное основание обработки, поэтому контакт будет обезличен сразу же — ФИО, должность, почта, телефон и заметки будут стёрты.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            isLoading={withdraw.isPending}
            disabled={withdrawalReference.trim().length < 3}
          >
            Отозвать и обезличить
          </Button>
        </>
      }
    >
      <Input
        label="Документ отзыва"
        required
        placeholder="Входящий № 7 от 20.09.2026, папка «Обращения»"
        hint="Входящий номер, дата и где он хранится"
        value={withdrawalReference}
        onChange={(event) => setWithdrawalReference(event.target.value)}
        error={detailFor(withdraw.error, 'withdrawalReference')}
      />
    </Modal>
  )
}

function basisHistoryTitle(entry: ContactBasisHistoryEntryDto): string {
  if (entry.kind === 'consent.withdraw') return 'Согласие отозвано'
  const from = entry.fromBasis ? CONTACT_LEGAL_BASIS_LABELS[entry.fromBasis] : 'не зафиксировано'
  return `${from} → ${CONTACT_LEGAL_BASIS_LABELS[entry.toBasis]}`
}

function HistoryDrawer({ contact, universityId, onClose }: { contact: ContactDto; universityId: string; onClose: () => void }) {
  const history = useResource<ContactBasisHistoryEntryDto[]>(
    `/api/universities/${universityId}/contacts/${contact.id}/legal-basis/history${buildQuery({ pageSize: 50 })}`,
  )

  return (
    <Drawer isOpen onClose={onClose} title="История основания и согласия" description={contact.fullName}>
      {history.isLoading && <p className={styles.rowMeta}>Загрузка…</p>}
      {history.error && <ErrorState error={history.error} onRetry={history.reload} />}
      {history.data && history.data.length === 0 && (
        <EmptyState icon="clock" title="Записей нет" description="Основание ещё не менялось." />
      )}
      {history.data && history.data.length > 0 && (
        <div className={styles.events}>
          {history.data.map((entry) => (
            <div key={entry.id} className={styles.event}>
              <div className={styles.eventText}>
                <span className={styles.eventTitle}>{basisHistoryTitle(entry)}</span>
                <span className={styles.eventDetails}>
                  {CONSENT_STATUS_LABELS[entry.fromConsentStatus]} → {CONSENT_STATUS_LABELS[entry.toConsentStatus]}
                  {entry.referenceChanged && ' · документ изменён'}
                  {entry.anonymized && ' · контакт обезличен'}
                </span>
                <span className={styles.eventMeta}>
                  {formatDateTime(entry.changedAt)} · {entry.changedBy.fullName}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}

function LegalBasisBlock({
  contact,
  universityId,
  canWrite,
  onChanged,
}: {
  contact: ContactDto
  universityId: string
  canWrite: boolean
  onChanged: (contact: ContactDto) => void
}) {
  const [action, setAction] = useState<'edit' | 'withdraw' | 'history' | null>(null)
  const basis = contact.legalBasis

  // «История» и правка ходят на CONTACT_BASIS (assertCan): у этого права ровно тот
  // же список ролей, что у WRITE, и оно тоже недоступно эксперту хакатона —
  // поэтому кнопки действий гасит тот же `canWrite`, что и у остальных правок.
  // Значения самого основания (когда сервер их прислал) видны и без кнопок.
  return (
    <div className={styles.contactBasis}>
      <span className={styles.rowMeta}>
        {basis ? (
          <>
            Основание: {CONTACT_LEGAL_BASIS_LABELS[basis.basis]}
            {basis.consentStatus !== 'NONE' && ` · ${CONSENT_STATUS_LABELS[basis.consentStatus]}`}
            {basis.consentStatus === 'OBTAINED' && basis.consentObtainedAt && ` от ${formatDate(basis.consentObtainedAt)}`}
            {basis.consentStatus === 'WITHDRAWN' && basis.consentWithdrawnAt && ` от ${formatDate(basis.consentWithdrawnAt)}`}
          </>
        ) : (
          `Основание обработки ПД: ${contact.basisRecorded ? 'зафиксировано' : 'не зафиксировано'}`
        )}
      </span>

      {canWrite && (
        <span className={styles.contactActions}>
          <Button variant="ghost" size="sm" onClick={() => setAction('edit')}>
            {basis ? 'Изменить основание' : 'Зафиксировать основание'}
          </Button>
          {basis?.consentStatus === 'OBTAINED' && (
            <Button variant="ghost" size="sm" onClick={() => setAction('withdraw')}>
              Отозвать согласие
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setAction('history')}>
            История
          </Button>
        </span>
      )}

      {action === 'edit' && (
        <EditBasisModal
          contact={contact}
          universityId={universityId}
          onClose={() => setAction(null)}
          onChanged={onChanged}
        />
      )}
      {action === 'withdraw' && basis && (
        <WithdrawConsentModal
          contact={contact}
          universityId={universityId}
          onClose={() => setAction(null)}
          onChanged={onChanged}
        />
      )}
      {action === 'history' && (
        <HistoryDrawer contact={contact} universityId={universityId} onClose={() => setAction(null)} />
      )}
    </div>
  )
}

// ─────────────────────────────────── Обезличивание ───────────────────────────────────

function AnonymizeModal({
  contact,
  universityId,
  onClose,
  onChanged,
}: {
  contact: ContactDto
  universityId: string
  onClose: () => void
  onChanged: (contact: ContactDto) => void
}) {
  const toast = useToast()
  const anonymize = useMutation(async () => {
    const result = await apiPost<ContactDto>(`/api/universities/${universityId}/contacts/${contact.id}/anonymize`)
    return result.data
  })

  async function submit() {
    const result = await anonymize.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Персональные данные контакта удалены')
    onChanged(result.data)
    onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Удалить персональные данные контакта"
      description="Необратимо. ФИО, должность, почта, телефон и заметки будут стёрты, запись останется как «Контакт удалён» — ради встреч и истории работы с вузом."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="danger" onClick={submit} isLoading={anonymize.isPending}>
            Удалить данные
          </Button>
        </>
      }
    >
      <p className={styles.rowMeta}>
        Контакт: {contact.fullName}
        {contact.position ? `, ${contact.position}` : ''}. Делайте это по запросу самого человека
        или когда сотрудничество с вузом прекращено и срок хранения истёк. Тот же результат даёт
        обезличивание по зарегистрированному запросу субъекта («Настройки → Запросы субъектов»).
      </p>
    </Modal>
  )
}

// ─────────────────────────────────────── Строка ───────────────────────────────────────

function ContactRow({
  contact,
  universityId,
  canSeeContactDetails,
  canWrite,
  isAdmin,
  onChanged,
}: {
  contact: ContactDto
  universityId: string
  canSeeContactDetails: boolean
  canWrite: boolean
  isAdmin: boolean
  onChanged: (contact: ContactDto) => void
}) {
  const [anonymizing, setAnonymizing] = useState(false)

  return (
    <span className={styles.contact}>
      <Avatar name={contact.fullName} size="sm" />
      <span className={styles.contactText}>
        <span className={styles.contactName}>
          {contact.fullName}
          {contact.isPrimary && <span className={styles.primaryTag}> · основной</span>}
        </span>
        <span className={styles.contactMeta}>{contact.position ?? 'должность не указана'}</span>

        {!contact.isAnonymized && (
          <span className={styles.contactLinks}>
            {(contact.emailMasked || contact.phoneMasked) && (
              <>
                {contact.emailMasked && <span className={styles.idCode}>{contact.emailMasked}</span>}
                {contact.phoneMasked && <span className={styles.idCode}>{contact.phoneMasked}</span>}
                {canSeeContactDetails && <RevealAction contact={contact} />}
              </>
            )}
          </span>
        )}

        {!contact.isAnonymized && <LegalBasisBlock contact={contact} universityId={universityId} canWrite={canWrite} onChanged={onChanged} />}

        {isAdmin && !contact.isAnonymized && (
          <span className={styles.contactActions}>
            <Button variant="ghost" size="sm" onClick={() => setAnonymizing(true)}>
              Удалить персональные данные
            </Button>
            <CopyContactIdButton contact={contact} />
          </span>
        )}
      </span>

      {anonymizing && (
        <AnonymizeModal
          contact={contact}
          universityId={universityId}
          onClose={() => setAnonymizing(false)}
          onChanged={onChanged}
        />
      )}
    </span>
  )
}

export function ContactsCard({
  universityId,
  contacts,
  onChanged,
}: {
  universityId: string
  contacts: ContactDto[]
  /** Контакт изменился (правка основания, отзыв, обезличивание) — карточку вуза стоит перечитать. */
  onChanged: () => void
}) {
  const user = useCurrentUser()

  if (contacts.length === 0) {
    return <p className={styles.rowMeta}>Контактные лица не заведены.</p>
  }

  return (
    <div className={styles.contacts}>
      {contacts.map((contact) => (
        <ContactRow
          key={contact.id}
          contact={contact}
          universityId={universityId}
          canSeeContactDetails={user.permissions.canSeeContactDetails}
          canWrite={user.permissions.canWrite}
          isAdmin={user.permissions.isAdmin}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}
