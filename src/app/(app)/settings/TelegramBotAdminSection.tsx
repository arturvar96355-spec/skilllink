'use client'

import { useState } from 'react'
import type { TelegramAdminStatusDto, TelegramWebhookSecretRotatedDto, TelegramTestSentDto } from '@/shared/contracts'
import {
  Badge,
  Button,
  ErrorState,
  Input,
  Modal,
  Select,
  apiDelete,
  apiPost,
  apiPut,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import { Row, RowsSkeleton } from './SettingsRow'
import styles from './settings.module.css'

/**
 * «Настройки → Интеграции»: блок бота Telegram, только ADMIN (решение 142).
 *
 * Отдельный файл-компонент, как и остальные вкладки администратора
 * (`UsersSection`, `AuditSection`): страница `page.tsx` только подключает его
 * внутри раздела «Интеграции», когда `isAdmin`, — фронтендер, дорабатывающий
 * саму страницу настроек, этот файл не задевает.
 *
 * Данные и мутации — свои: `GET /api/admin/telegram` и четыре действия
 * (сменить токен, отключить, сменить режим, проверочное сообщение), плюс уже
 * существующий `POST /api/admin/telegram/rotate-webhook-secret` (решение 133).
 */

const MODE_OPTIONS = [
  { value: 'auto', label: 'Автоматически (вебхук, иначе polling)' },
  { value: 'webhook', label: 'Только вебхук' },
  { value: 'polling', label: 'Только polling (без вебхука)' },
]

const RUNNING_LABELS: Record<TelegramAdminStatusDto['running'], string> = {
  webhook: 'вебхук',
  polling: 'polling',
  off: 'не принимает',
}

const TOKEN_SOURCE_LABELS: Record<TelegramAdminStatusDto['tokenSource'], string> = {
  database: 'из базы (задан в этой админке)',
  env: 'из переменной окружения сервера',
  none: 'не задан',
}

/** Зелёный/жёлтый/красный — одним взглядом, без чтения всех полей подряд. */
function statusTone(status: TelegramAdminStatusDto): { tone: 'success' | 'warning' | 'danger'; label: string } {
  if (!status.configured) return { tone: 'danger', label: 'Не настроен' }
  if (status.running === 'off') return { tone: 'danger', label: 'Не принимает обновления' }
  if (status.lastErrorMessage) return { tone: 'warning', label: 'Требует внимания' }
  if (status.mode === 'auto' && status.running === 'polling') {
    return { tone: 'warning', label: 'Работает (авто-переход на polling)' }
  }
  return { tone: 'success', label: 'Работает' }
}

/** «Сменить токен»: поле пароля — токен не должен быть виден на экране случайно. */
function ChangeTokenModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const [token, setToken] = useState('')
  const [touched, setTouched] = useState(false)

  const save = useMutation(async (value: string) => (await apiPut<TelegramAdminStatusDto>('/api/admin/telegram/token', { token: value })).data)

  async function submit() {
    setTouched(true)
    if (token.trim().length < 20) return
    const result = await save.run(token.trim())
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`Токен сменён: бот @${result.data.botUsername ?? '—'}`)
    onChanged()
    onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop={false}
      title="Сменить токен бота"
      description="Токен выдаёт @BotFather (команда /token или /newbot). Хранится зашифрованно."
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
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Input
          label="Токен"
          required
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          hint="Проверяется у Telegram до сохранения — неверный токен отклоняется, прежний остаётся действовать."
          error={touched && token.trim().length < 20 ? 'Похоже, это не токен целиком' : (save.error?.message ?? null)}
        />
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}

function DisconnectModal({ onClose, onConfirm, isPending }: { onClose: () => void; onConfirm: () => void; isPending: boolean }) {
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Отключить бота?"
      description="Токен удаляется из базы, вебхук снимается, приём обновлений останавливается. Токен, заданный переменной окружения сервера (если есть), продолжит действовать."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="danger" onClick={onConfirm} isLoading={isPending}>
            Отключить
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  )
}

export function TelegramBotAdminSection() {
  const toast = useToast()
  const status = useResource<TelegramAdminStatusDto>('/api/admin/telegram')
  const [tokenModalOpen, setTokenModalOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const setMode = useMutation(async (mode: string) => (await apiPut<TelegramAdminStatusDto>('/api/admin/telegram/mode', { mode })).data)
  const disconnect = useMutation(async () => (await apiDelete<TelegramAdminStatusDto>('/api/admin/telegram/token')).data)
  const sendTest = useMutation(async () => (await apiPost<TelegramTestSentDto>('/api/admin/telegram/test')).data)
  const rotateSecret = useMutation(
    async () => (await apiPost<TelegramWebhookSecretRotatedDto>('/api/admin/telegram/rotate-webhook-secret')).data,
  )

  if (status.isLoading) return <RowsSkeleton count={4} />
  if (status.error) return <ErrorState error={status.error} onRetry={status.reload} />
  const data = status.data
  if (!data) return null

  async function onModeChange(mode: string) {
    const result = await setMode.run(mode)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Режим приёма обновлений изменён')
    status.reload()
  }

  async function onDisconnect() {
    const result = await disconnect.run(undefined)
    setDisconnectOpen(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Бот отключён')
    status.reload()
  }

  async function onSendTest() {
    const result = await sendTest.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(result.data.sentTo === 'admin' ? 'Отправлено в ваш чат Telegram' : 'Отправлено в чат владельца')
  }

  async function onRotateSecret() {
    const result = await rotateSecret.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Секрет вебхука сменён')
    status.reload()
  }

  const { tone, label } = statusTone(data)

  return (
    <>
      <Row
        title="Бот Telegram"
        caption={
          data.botUsername
            ? `@${data.botUsername} · режим «${MODE_OPTIONS.find((option) => option.value === data.mode)?.label ?? data.mode}» ` +
              `· сейчас: ${RUNNING_LABELS[data.running]}`
            : 'Токен не задан'
        }
        hint="Токен — из переменной окружения сервера или из этой админки (сохранённый здесь — главнее). Ни тот ни другой нигде не показываются."
      >
        <Badge tone={tone} withDot>
          {label}
        </Badge>
      </Row>

      {data.botUsername && (
        <Row title="Открыть бота" caption={`t.me/${data.botUsername}`}>
          <Button variant="secondary" href={`https://t.me/${data.botUsername}`} external size="sm">
            Открыть
          </Button>
        </Row>
      )}

      {data.lastErrorMessage && (
        <Row title="Последняя ошибка вебхука" caption={data.lastErrorMessage} />
      )}

      <Row
        title="Режим приёма обновлений"
        caption="«Автоматически» — вебхук, а если он перестал отвечать, процесс сам переходит на polling."
      >
        <Select
          label="Режим приёма обновлений"
          hideLabel
          value={data.mode}
          onValueChange={onModeChange}
          options={MODE_OPTIONS}
          disabled={!data.configured || setMode.isPending}
        />
      </Row>

      <Row title="Привязано сотрудников" caption="Личные уведомления в личном кабинете (решение 102)">
        <span className={styles.number}>{data.linkedEmployeeCount}</span>
      </Row>

      <Row title="Токен" caption={`Источник: ${TOKEN_SOURCE_LABELS[data.tokenSource]}`}>
        <div className={styles.rowActions}>
          <Button variant="secondary" size="sm" onClick={() => setTokenModalOpen(true)}>
            Сменить токен
          </Button>
          {data.configured && (
            <Button variant="danger" size="sm" onClick={() => setDisconnectOpen(true)}>
              Отключить бота
            </Button>
          )}
        </div>
      </Row>

      <Row title="Секрет вебхука" caption="Меняется независимо от токена; вебхук узнаёт новый секрет сразу (решение 133)">
        <Button variant="secondary" size="sm" onClick={onRotateSecret} isLoading={rotateSecret.isPending} disabled={!data.configured}>
          Сменить секрет вебхука
        </Button>
      </Row>

      <Row title="Проверочное сообщение" caption="В ваш чат Telegram, если вы сами его подключили, иначе — в чат владельца">
        <Button variant="secondary" size="sm" onClick={onSendTest} isLoading={sendTest.isPending} disabled={!data.configured}>
          Отправить проверочное сообщение
        </Button>
      </Row>

      {tokenModalOpen && (
        <ChangeTokenModal onClose={() => setTokenModalOpen(false)} onChanged={status.reload} />
      )}
      {disconnectOpen && (
        <DisconnectModal onClose={() => setDisconnectOpen(false)} onConfirm={onDisconnect} isPending={disconnect.isPending} />
      )}
    </>
  )
}
