'use client'

import { useEffect, useId, useState } from 'react'
import type { AiLetterInstructionDto } from '@/shared/contracts'
import {
  Badge,
  Button,
  ErrorState,
  Modal,
  Textarea,
  apiDelete,
  apiPut,
  formatDateTime,
  formatNumber,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import { Row, RowsSkeleton } from './SettingsRow'
import settingsStyles from './settings.module.css'
import styles from './AiLetterInstructionSection.module.css'

/**
 * «Настройки → ИИ-помощник»: инструкция для писем, только ADMIN (решение 213).
 *
 * Отдельный файл, как `TelegramBotAdminSection`: страница настроек только
 * подключает раздел. Инструкция встаёт в промпт писем перед базовыми правилами;
 * сами правила показаны здесь же — чтобы было видно, что отменить их нельзя.
 */

const EXAMPLE = [
  'Например:',
  'Тон — доброжелательный, на «вы», без канцелярита.',
  'Подпись: «С уважением, команда партнёрских программ ИТ-Школы РТК».',
  'Если вопрос требует обсуждения — предлагать короткий созвон.',
  'Не обещать сроков, которых нет в фактах.',
].join('\n')

export function AiLetterInstructionSection() {
  const toast = useToast()
  const counterId = useId()
  const instruction = useResource<AiLetterInstructionDto>('/api/settings/ai-letter-instruction')
  const [text, setText] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  const saved = instruction.data?.text ?? ''
  useEffect(() => {
    setText(saved)
  }, [saved])

  const save = useMutation(
    async (value: string) =>
      (await apiPut<AiLetterInstructionDto>('/api/settings/ai-letter-instruction', { text: value })).data,
  )
  const reset = useMutation(
    async () => (await apiDelete<AiLetterInstructionDto>('/api/settings/ai-letter-instruction')).data,
  )

  if (instruction.isLoading) return <RowsSkeleton count={3} />
  if (instruction.error) return <ErrorState error={instruction.error} onRetry={instruction.reload} />
  if (!instruction.data) return null

  const data = instruction.data
  const dirty = text.trim() !== saved.trim()
  const tooLong = text.length > data.maxLength

  async function onSave() {
    const result = await save.run(text)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(result.data.isDefault ? 'Инструкция пустая — письма пишутся по базовым правилам' : 'Инструкция для писем сохранена')
    instruction.reload()
  }

  async function onReset() {
    const result = await reset.run(undefined)
    setConfirmReset(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setText('')
    toast.success('Вернули по умолчанию: письма пишутся по базовым правилам')
    instruction.reload()
  }

  return (
    <>
      <Row
        title="Инструкция для писем"
        hint="Ваши пожелания к письмам, которые пишет ИИ: тон, подпись, что обязательно упомянуть, чего избегать. Действует на письмо вузу по рекомендации, ответ на письмо вуза и их переделку кнопками «Короче», «Мягче» и другими. Базовые правила ниже инструкция не отменяет."
        caption={
          data.isDefault
            ? 'Сейчас письма пишутся только по базовым правилам.'
            : `Изменена ${formatDateTime(data.updatedAt)}${data.updatedByName ? ` — ${data.updatedByName}` : ''}.`
        }
      >
        <Badge tone={data.isDefault ? 'neutral' : 'accent'} withDot>
          {data.isDefault ? 'По умолчанию' : 'Своя инструкция'}
        </Badge>
      </Row>

      <div className={styles.form}>
        <Textarea
          label="Текст инструкции"
          rows={7}
          value={text}
          placeholder={EXAMPLE}
          onChange={(event) => setText(event.target.value)}
          aria-describedby={counterId}
          hint="Имена, телефоны и почта из инструкции в ИИ не уходят — их скрывает маскировка. Подпись с ФИО добавьте в письмо вручную."
          error={tooLong ? `Длиннее ${formatNumber(data.maxLength)} знаков — оставьте главное` : null}
        />
        <div className={styles.actions}>
          <Button variant="primary" icon="check" onClick={onSave} disabled={!dirty || tooLong} isLoading={save.isPending}>
            Сохранить
          </Button>
          <Button
            variant="ghost"
            icon="refresh"
            onClick={() => setConfirmReset(true)}
            disabled={data.isDefault && text.trim() === ''}
          >
            Вернуть по умолчанию
          </Button>
          <span id={counterId} className={[styles.counter, tooLong ? styles.counterOver : ''].filter(Boolean).join(' ')}>
            {formatNumber(text.length)} из {formatNumber(data.maxLength)} знаков
          </span>
        </div>
      </div>

      <div className={styles.rulesBlock}>
        <span className={settingsStyles.rowTitle}>Базовые правила</span>
        <span className={settingsStyles.rowCaption}>
          Действуют всегда и стоят в запросе к ИИ после вашей инструкции — отменить их она не может.
        </span>
        <ul className={styles.rules}>
          {data.baseRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>

      {confirmReset && (
        <Modal
          isOpen
          onClose={() => setConfirmReset(false)}
          title="Вернуть по умолчанию?"
          description="Инструкция удалится, и письма снова будут писаться только по базовым правилам. Изменение попадёт в журнал действий."
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                Отмена
              </Button>
              <Button variant="primary" onClick={onReset} isLoading={reset.isPending}>
                Вернуть по умолчанию
              </Button>
            </>
          }
        >
          {null}
        </Modal>
      )}
    </>
  )
}
