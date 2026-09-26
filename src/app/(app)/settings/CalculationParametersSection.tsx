'use client'

import { useState } from 'react'
import type { CalculationParametersDto, StalledPreviewDto } from '@/shared/contracts'
import {
  Badge,
  Button,
  ErrorState,
  Input,
  MockBadge,
  apiGet,
  buildQuery,
  formatCount,
  useMutation,
  useResource,
} from '@/ui'
import { formatParameterValue } from './parameter-format'
import { Row, RowsSkeleton } from './SettingsRow'
import settings from './settings.module.css'

/**
 * «Настройки → Параметры расчётов» (решение 107): значения, с которыми сейчас
 * считает код, — только чтение. `GET /api/settings/parameters` не пишет ничего,
 * менять коэффициенты можно только правкой конфигурации на сервере (CLAUDE.md,
 * `shared/config`); экран лишь показывает то, что сейчас утверждено рабочим
 * (`isTemporary`, комментарий `// TEMP` в коде) и что уже согласовано.
 */
export function CalculationParametersSection() {
  const parameters = useResource<CalculationParametersDto>('/api/settings/parameters')

  if (parameters.isLoading) return <RowsSkeleton count={6} />
  if (parameters.error) return <ErrorState error={parameters.error} onRetry={parameters.reload} />
  const data = parameters.data
  if (!data) return null

  return (
    <div className={settings.rows}>
      {data.temporaryCount > 0 && (
        <p className={settings.muted}>
          {formatCount(data.temporaryCount, ['значение ждёт', 'значения ждут', 'значений ждут'])} утверждения
          с заказчиком (рабочие, помечены «черновое»).
        </p>
      )}

      {data.groups.map((group) => (
        <section key={group.id} className={settings.group}>
          <h3 className={settings.groupTitle}>{group.title}</h3>
          <p className={settings.muted}>{group.description}</p>
          <p className={settings.muted}>
            Методика: {group.methodology.document} — «{group.methodology.section}»
          </p>
          {group.parameters.map((param) => (
            <Row key={param.configKey} title={param.label} caption={param.hint ?? undefined}>
              <span className={settings.paramValue}>
                {formatParameterValue(param)}
                {param.isTemporary && <Badge tone="warning">черновое</Badge>}
              </span>
            </Row>
          ))}
        </section>
      ))}

      <section className={settings.group}>
        <h3 className={settings.groupTitle}>Нормативы этапов</h3>
        <p className={settings.muted}>
          Срок в днях от даты создания связки, по которому считается просрочка. Методика — в группе «Ход работы».
        </p>
        {data.stages.map((stage) => (
          <Row
            key={stage.number}
            title={`${stage.number}. ${stage.title}`}
            caption={`${stage.phaseLabel}${stage.isControlPoint ? ' · контрольная точка' : ''}`}
          >
            <span className={settings.paramValue}>
              {formatCount(stage.normativeDays, ['день', 'дня', 'дней'])}
              {stage.isTemporary && <Badge tone="warning">черновое</Badge>}
            </span>
          </Row>
        ))}
      </section>

      <StalledPreviewSection />
    </div>
  )
}

/**
 * Предпросмотр порога застоя (решение 120): сколько открытых связок станут
 * или перестанут быть «застрявшими» при другом пороге — до того, как менять
 * значение в конфигурации. Ничего не сохраняет: только `GET`.
 */
function StalledPreviewSection() {
  const [days, setDays] = useState('30')
  const [preview, setPreview] = useState<StalledPreviewDto | null>(null)

  const run = useMutation(async (value: number) => {
    const result = await apiGet<StalledPreviewDto>(`/api/analytics/stalled-preview${buildQuery({ days: value })}`)
    return result.data
  })

  const parsedDays = Number(days)
  const isValidDays = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 365

  async function onPreview() {
    if (!isValidDays) return
    const result = await run.run(parsedDays)
    if (result.ok) setPreview(result.data)
  }

  return (
    <section className={settings.group}>
      <h3 className={settings.groupTitle}>Предпросмотр порога застоя</h3>
      <p className={settings.muted}>
        Порог по умолчанию система считает по фактическим срокам этапов (p90). Здесь можно посмотреть, что изменится
        при другом пороге, без изменения настроек — правка самого значения остаётся в конфигурации на сервере.
      </p>

      <div className={settings.stalledForm}>
        <Input
          label="Порог, дней без движения"
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(event) => setDays(event.target.value)}
          error={isValidDays ? null : 'От 1 до 365 дней'}
        />
        <Button variant="secondary" onClick={onPreview} isLoading={run.isPending} disabled={!isValidDays}>
          Показать
        </Button>
      </div>

      {run.error && <p className={settings.muted}>{run.error.message}</p>}

      {preview && (
        <div className={settings.stalledResult}>
          <p className={settings.muted}>
            Сейчас застряло связок: {preview.before}. При пороге {preview.proposedDays} дней стало бы:{' '}
            {preview.after}.{preview.isMock && ' '}
            {preview.isMock && <MockBadge />}
          </p>
          {preview.suppressedByOverdue > 0 && (
            <p className={settings.muted}>
              Ещё {formatCount(preview.suppressedByOverdue, ['связка', 'связки', 'связок'])} не считается застрявшей:
              по ней уже есть рекомендация о просрочке.
            </p>
          )}
          {preview.stages
            .filter((stage) => stage.before !== stage.after)
            .map((stage) => (
              <Row
                key={stage.stageNumber}
                title={`${stage.stageNumber}. ${stage.title}`}
                caption={`Открытых связок на этапе: ${stage.open}`}
              >
                <span className={settings.paramValue}>
                  {stage.before} → {stage.after}
                </span>
              </Row>
            ))}
        </div>
      )}
    </section>
  )
}
