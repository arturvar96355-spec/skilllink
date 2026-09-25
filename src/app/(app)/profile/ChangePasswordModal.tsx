'use client'

import { useState } from 'react'
import type { PasswordChangedDto } from '@/shared/contracts'
import { Button, Icon, Input, Modal, apiPost, useMutation, useToast } from '@/ui'
import styles from './profile.module.css'

/** Не короче — то же правило, что на сервере (PASSWORD_POLICY.minLength). */
const MIN_LENGTH = 10

/**
 * Смена своего пароля — любая роль, включая представителя вуза.
 *
 * Правила нового пароля проверяет сервер (auth.rules.ts); форма заранее ловит
 * только то, что видно без него: длину и несовпадение повтора. Повтор на сервер
 * не уходит — ему он ничего не добавляет.
 */
export function ChangePasswordModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [touched, setTouched] = useState(false)

  const change = useMutation(async (body: { currentPassword: string; newPassword: string }) => {
    const result = await apiPost<PasswordChangedDto>('/api/me/password', body)
    return result.data
  })

  const serverError = (field: string): string | null => {
    const details = change.error?.details
    if (!Array.isArray(details)) return null
    const match = (details as Array<{ field?: unknown; message?: unknown }>).find((item) => item?.field === field)
    return typeof match?.message === 'string' ? match.message : null
  }

  const tooShort = touched && newPassword.length > 0 && [...newPassword].length < MIN_LENGTH
  const mismatch = touched && repeat !== '' && repeat !== newPassword
  const general =
    change.error && !serverError('currentPassword') && !serverError('newPassword') ? change.error.message : null

  async function submit() {
    setTouched(true)
    if (currentPassword === '' || [...newPassword].length < MIN_LENGTH || repeat !== newPassword) return
    const result = await change.run({ currentPassword, newPassword })
    if (!result.ok) return
    toast.success('Пароль изменён. В следующий раз входите с новым')
    onChanged()
    onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop={false}
      title="Сменить пароль"
      description={`Новый пароль — не короче ${MIN_LENGTH} символов, не совпадает с текущим и с адресом почты.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={change.isPending}>
            Сменить пароль
          </Button>
        </>
      }
    >
      {/* Форма — чтобы менеджер паролей браузера предложил сохранить новый. */}
      <form
        className={styles.passwordForm}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Input
          label="Текущий пароль"
          required
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          error={
            serverError('currentPassword') ?? (touched && currentPassword === '' ? 'Введите текущий пароль' : null)
          }
        />
        <Input
          label="Новый пароль"
          required
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          hint={`Не короче ${MIN_LENGTH} символов`}
          error={serverError('newPassword') ?? (tooShort ? `Не короче ${MIN_LENGTH} символов` : null)}
        />
        <Input
          label="Новый пароль ещё раз"
          required
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          error={mismatch ? 'Пароли не совпадают' : null}
        />
        {/* Enter в поле отправляет форму; видимая кнопка — в подвале окна. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
      {general && (
        <div className={styles.passwordProblem} role="alert">
          <Icon name="alert" size={16} />
          <p>{general}</p>
        </div>
      )}
    </Modal>
  )
}
