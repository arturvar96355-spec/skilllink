'use client'

import { useRef, useState } from 'react'
import {
  USER_ROLES,
  USER_ROLE_LABELS,
  canBeResponsible,
  type IssuedPasswordDto,
  type ManagedUserDto,
  type UniversityListItemDto,
  type UserDto,
  type UserRole,
} from '@/shared/contracts'
import {
  type ApiRequestError,
  Button,
  Icon,
  Input,
  Modal,
  RemoteSelect,
  Select,
  apiPatch,
  apiPost,
  formatCount,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
  universityFullOption,
} from '@/ui'
import styles from './admin.module.css'
import { SHARED_DEMO_ACCOUNT_REFUSAL, isSharedDemoAccount } from '@/shared/config/auth.config'

/**
 * Окна вкладки «Пользователи»: заведение, изменение с блокировкой и выдачей
 * пароля, показ одноразового временного пароля.
 */

const ROLE_OPTIONS = USER_ROLES.map((role) => ({ value: role, label: USER_ROLE_LABELS[role] }))

/** Ошибка поля из ответа сервера — и у 422, и у 409 (занятая почта). */
function detailFor(error: ApiRequestError | null, field: string): string | null {
  if (!error || !Array.isArray(error.details)) return null
  const match = (error.details as Array<{ field?: unknown; message?: unknown }>).find(
    (item) => item?.field === field,
  )
  return typeof match?.message === 'string' ? match.message : null
}

/** Текст отказа, если он не разложен по полям: его показывают плашкой в окне. */
function formError(error: ApiRequestError | null, fields: string[]): string | null {
  if (!error) return null
  if (fields.some((field) => detailFor(error, field))) return null
  return error.message
}

function Problem({ text }: { text: string }) {
  return (
    <div className={styles.danger} role="alert">
      <Icon name="alert" size={16} />
      <p>{text}</p>
    </div>
  )
}

/** «3 открытые связки и 12 незакрытых этапов». */
function openWorkText(user: Pick<ManagedUserDto, 'openCooperations' | 'openStages'>): string | null {
  const parts = [
    user.openCooperations > 0
      ? formatCount(user.openCooperations, ['открытая связка', 'открытые связки', 'открытых связок'])
      : null,
    user.openStages > 0
      ? formatCount(user.openStages, ['незакрытый этап', 'незакрытых этапа', 'незакрытых этапов'])
      : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' и ') : null
}

// ── Одноразовый пароль ──────────────────────────────────────────────────────

export interface IssuedPassword extends IssuedPasswordDto {
  kind: 'create' | 'reset'
}

/**
 * Временный пароль показывается один раз. Закрыть окно щелчком мимо нельзя:
 * случайный щелчок стоил бы выдачи нового пароля.
 */
export function PasswordIssuedModal({ issued, onClose }: { issued: IssuedPassword; onClose: () => void }) {
  const toast = useToast()
  const valueRef = useRef<HTMLSpanElement>(null)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.temporaryPassword)
      setCopied(true)
      toast.success('Пароль скопирован')
    } catch {
      // Буфер обмена недоступен (не HTTPS, запрет браузера) — выделяем пароль,
      // чтобы скопировать его сочетанием клавиш.
      const node = valueRef.current
      if (node) window.getSelection()?.selectAllChildren(node)
      toast.info('Скопировать не удалось — пароль выделен, нажмите Ctrl+C или ⌘C')
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop={false}
      title={issued.kind === 'create' ? 'Пользователь заведён' : 'Новый временный пароль'}
      description="Пароль показывается один раз. Больше мы его не покажем — только выдадим новый."
      footer={
        <Button variant="primary" onClick={onClose}>
          Готово, пароль передан
        </Button>
      }
    >
      <div className={styles.who}>
        <strong>{issued.user.fullName}</strong>
        <span>
          {USER_ROLE_LABELS[issued.user.role]}
          {issued.user.email ? ` · ${issued.user.email}` : ''}
        </span>
      </div>

      <div className={styles.password}>
        <span ref={valueRef} className={styles.passwordValue} aria-label="Временный пароль">
          {issued.temporaryPassword}
        </span>
        <Button variant="secondary" icon={copied ? 'check' : undefined} onClick={copy}>
          {copied ? 'Скопировано' : 'Скопировать'}
        </Button>
      </div>

      <div className={styles.warning}>
        <Icon name="alert" size={16} />
        <p>
          Передайте пароль лично или по телефону — не пересылайте в общих чатах и почте.
          При первом входе человеку стоит сменить его в личном кабинете: там он увидит напоминание.
        </p>
      </div>
    </Modal>
  )
}

// ── Заведение ───────────────────────────────────────────────────────────────

export function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (issued: IssuedPasswordDto) => void
}) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [position, setPosition] = useState('')
  const [role, setRole] = useState<string>('')
  const [universityId, setUniversityId] = useState('')

  const create = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPost<IssuedPasswordDto>('/api/users', body)
    return result.data
  })
  const error = create.error
  const isRep = role === 'UNIVERSITY_REP'

  async function submit() {
    const result = await create.run({
      email: email.trim(),
      fullName: fullName.trim(),
      position: position.trim() === '' ? null : position.trim(),
      role: role === '' ? undefined : role,
      universityId: isRep && universityId !== '' ? universityId : null,
    })
    if (result.ok) onCreated(result.data)
  }

  const general = formError(error, ['email', 'fullName', 'position', 'role', 'universityId'])

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop={false}
      title="Завести пользователя"
      description="Пароль придумает система: временный, его покажут один раз после сохранения."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={create.isPending}>
            Завести
          </Button>
        </>
      }
    >
      <Input
        label="Рабочая почта"
        required
        type="email"
        autoComplete="off"
        placeholder="ivanova@example.ru"
        hint="Это логин. Изменить её потом нельзя"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={detailFor(error, 'email')}
      />
      <Input
        label="ФИО"
        required
        placeholder="Иванова Мария Сергеевна"
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        error={detailFor(error, 'fullName')}
      />
      <Input
        label="Должность"
        placeholder="Менеджер партнёрств"
        value={position}
        onChange={(event) => setPosition(event.target.value)}
        error={detailFor(error, 'position')}
      />
      <Select
        label="Роль"
        required
        placeholder="Выберите роль"
        value={role}
        onValueChange={(value) => {
          setRole(value)
          if (value !== 'UNIVERSITY_REP') setUniversityId('')
        }}
        options={ROLE_OPTIONS}
        error={detailFor(error, 'role')}
      />
      {isRep && (
        <RemoteSelect<UniversityListItemDto>
          label="Вуз представителя"
          required
          endpoint="/api/universities"
          params={{ withRating: 'false', sort: 'name' }}
          toOption={universityFullOption}
          searchPlaceholder="Название, краткое название или город"
          placeholder="Выберите вуз"
          value={universityId}
          onValueChange={setUniversityId}
          hint="Представитель видит только свой вуз"
          error={detailFor(error, 'universityId')}
        />
      )}
      {general && <Problem text={general} />}
    </Modal>
  )
}

// ── Изменение, пароль, блокировка ───────────────────────────────────────────

type Confirm = 'block' | 'reset' | null

export function UserModal({
  user,
  onClose,
  onChanged,
  onIssued,
}: {
  user: UserDto
  onClose: () => void
  /** Запись изменилась — список нужно перечитать. */
  onChanged: () => void
  onIssued: (issued: IssuedPasswordDto) => void
}) {
  const me = useCurrentUser()
  const toast = useToast()
  const isSelf = me.id === user.id
  // Общая демо-учётка: под ней входят все проверяющие — её не меняют (auth.config).
  const isSharedDemo = user.email ? isSharedDemoAccount(user.email) : false

  const details = useResource<ManagedUserDto>(`/api/users/${user.id}`)
  const [fullName, setFullName] = useState(user.fullName)
  const [position, setPosition] = useState(user.position ?? '')
  const [role, setRole] = useState<UserRole>(user.role)
  const [universityId, setUniversityId] = useState(user.universityId ?? '')
  const [confirm, setConfirm] = useState<Confirm>(null)

  const save = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPatch<UserDto>(`/api/users/${user.id}`, body)
    return result.data
  })
  const reset = useMutation(async () => {
    const result = await apiPost<IssuedPasswordDto>(`/api/users/${user.id}/password-reset`)
    return result.data
  })

  const isRep = role === 'UNIVERSITY_REP'
  const changes: Record<string, unknown> = {}
  if (fullName.trim() !== user.fullName) changes.fullName = fullName.trim()
  if ((position.trim() || null) !== user.position) changes.position = position.trim() === '' ? null : position.trim()
  if (role !== user.role) changes.role = role
  if (isRep && universityId !== (user.universityId ?? '')) changes.universityId = universityId || null
  const hasChanges = Object.keys(changes).length > 0

  const openWork = details.data ? openWorkText(details.data) : null
  // Та же проверка, что на сервере (auth.rules.ts): видно до нажатия, а не после отказа.
  const handOverFirst =
    openWork !== null && role !== user.role && canBeResponsible(user.role) && !canBeResponsible(role)

  async function submit() {
    const result = await save.run(changes)
    if (!result.ok) return
    toast.success('Изменения сохранены')
    onChanged()
    onClose()
  }

  async function setActive(isActive: boolean) {
    const result = await save.run({ isActive })
    if (!result.ok) {
      setConfirm(null)
      return
    }
    toast.success(
      isActive
        ? 'Учётная запись разблокирована: вход снова открыт'
        : 'Учётная запись заблокирована: вход и открытые сессии больше не работают',
    )
    onChanged()
    onClose()
  }

  async function issuePassword() {
    const result = await reset.run(undefined)
    if (!result.ok) {
      setConfirm(null)
      return
    }
    onIssued(result.data)
  }

  const error = save.error ?? reset.error
  const general = formError(error, ['fullName', 'position', 'role', 'universityId'])

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop={false}
      title={user.fullName}
      description={user.email ?? undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            isLoading={save.isPending && confirm === null}
            disabled={!hasChanges || handOverFirst || isSharedDemo}
          >
            Сохранить
          </Button>
        </>
      }
    >
      {isSharedDemo && (
        <div className={styles.warning}>
          <Icon name="info" size={16} />
          <p>{SHARED_DEMO_ACCOUNT_REFUSAL}</p>
        </div>
      )}
      <Input
        label="ФИО"
        required
        disabled={isSharedDemo}
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        error={detailFor(error, 'fullName')}
      />
      <Input
        label="Должность"
        disabled={isSharedDemo}
        value={position}
        onChange={(event) => setPosition(event.target.value)}
        error={detailFor(error, 'position')}
      />
      <Select
        label="Роль"
        required
        value={role}
        onValueChange={(value) => setRole(value as UserRole)}
        options={ROLE_OPTIONS}
        disabled={isSelf || isSharedDemo}
        hint={isSelf ? 'Свою роль меняет другой администратор' : undefined}
        error={detailFor(error, 'role')}
      />
      {isRep && (
        <RemoteSelect<UniversityListItemDto>
          label="Вуз представителя"
          required
          endpoint="/api/universities"
          params={{ withRating: 'false', sort: 'name' }}
          toOption={universityFullOption}
          searchPlaceholder="Название, краткое название или город"
          placeholder="Выберите вуз"
          value={universityId}
          onValueChange={setUniversityId}
          error={detailFor(error, 'universityId')}
        />
      )}

      {handOverFirst && (
        <div className={styles.warning}>
          <Icon name="alert" size={16} />
          <p>
            Сначала передайте связки: за сотрудником {openWork}. Роль «{USER_ROLE_LABELS[role]}» не может
            быть ответственной — переназначьте их другому менеджеру.
          </p>
        </div>
      )}

      {general && <Problem text={general} />}

      <section className={styles.access} aria-label="Доступ">
        <span className={styles.accessTitle}>Доступ</span>

        <div className={styles.accessRow}>
          <div className={styles.accessText}>
            <strong>Временный пароль</strong>
            <span>
              {isSelf
                ? 'Свой пароль меняйте в личном кабинете — там нужен текущий.'
                : 'Старый пароль перестанет подходить сразу. Новый покажем один раз.'}
            </span>
          </div>
          <Button
            variant="secondary"
            icon="refresh"
            size="sm"
            disabled={isSelf || isSharedDemo || confirm !== null}
            onClick={() => setConfirm('reset')}
          >
            Выдать новый
          </Button>
        </div>
        {confirm === 'reset' && (
          <div className={styles.notice}>
            <div>
              <p>Выдать {user.fullName} новый временный пароль? Текущий пароль перестанет подходить.</p>
              <div className={styles.confirm}>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  Отмена
                </Button>
                <Button variant="primary" size="sm" onClick={issuePassword} isLoading={reset.isPending}>
                  Выдать пароль
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className={styles.accessRow}>
          <div className={styles.accessText}>
            <strong>{user.isActive ? 'Учётная запись действует' : 'Учётная запись заблокирована'}</strong>
            <span>
              {isSelf
                ? 'Собственную учётную запись заблокировать нельзя.'
                : user.isActive
                  ? 'После блокировки вход и уже открытые сессии перестают работать сразу.'
                  : 'Вход закрыт. После разблокировки войти можно с прежним паролем.'}
            </span>
            {openWork && <span>Ответственный: {openWork}.</span>}
          </div>
          {user.isActive ? (
            <Button
              variant="danger"
              icon="block"
              size="sm"
              disabled={isSelf || isSharedDemo || confirm !== null}
              onClick={() => setConfirm('block')}
            >
              Заблокировать
            </Button>
          ) : (
            <Button variant="secondary" icon="check" size="sm" onClick={() => setActive(true)} isLoading={save.isPending}>
              Разблокировать
            </Button>
          )}
        </div>
        {confirm === 'block' && (
          <div className={openWork ? styles.warning : styles.notice}>
            {openWork && <Icon name="alert" size={16} />}
            <div>
              <p>
                {openWork
                  ? `За сотрудником ${openWork}. После блокировки он останется в них ответственным — передайте их другому менеджеру.`
                  : `Заблокировать ${user.fullName}? Вход и открытые сессии перестанут работать сразу.`}
              </p>
              <div className={styles.confirm}>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  Отмена
                </Button>
                <Button variant="danger" size="sm" onClick={() => setActive(false)} isLoading={save.isPending}>
                  Заблокировать
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>
    </Modal>
  )
}
