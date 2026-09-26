'use client'

import Link from 'next/link'
import { USER_ROLE_LABELS } from '@/shared/contracts'
import { Card, DownloadButton, Icon, PageHeader, ROUTES, Section, useCurrentUser } from '@/ui'
import styles from './data.module.css'

/**
 * «Мои данные» (ТЗ дизайна 26–29.09, п. 4.6): что система знает о пользователе
 * и что он может сделать с этим сам — в пределах своей роли.
 *
 * Выгрузка — `GET /api/me/data-export` (решение 116): тот же файл «всё о субъекте»,
 * что готовит администратор по запросу, только о себе. Сервер отдаёт его не чаще
 * раза в 10 минут и на повтор отвечает текстом, сколько ждать, — кнопка
 * показывает этот текст как есть. Каждая выгрузка записывается в журнал: об этом
 * сказано прямо, чтобы нажатие не было сюрпризом.
 */
export default function MyDataPage() {
  const user = useCurrentUser()

  const facts: Array<{ label: string; value: string | null }> = [
    { label: 'ФИО', value: user.fullName },
    { label: 'Должность', value: user.position },
    { label: 'Рабочая почта', value: user.email },
    { label: 'Роль', value: USER_ROLE_LABELS[user.role] },
    ...(user.universityName ? [{ label: 'Вуз', value: user.universityName }] : []),
  ]

  return (
    <>
      <PageHeader
        title="Мои данные"
        description="Что SkillLink хранит о вас и что вы можете с этим сделать сами."
        breadcrumbs={[{ label: 'Личный кабинет', href: ROUTES.profile }, { label: 'Мои данные' }]}
      />

      <Section title="Учётная запись" description="Эти сведения видят коллеги в назначениях и журнале действий.">
        <Card>
          <dl className={styles.facts}>
            {facts.map((fact) => (
              <div key={fact.label} className={styles.fact}>
                <dt className={styles.factLabel}>{fact.label}</dt>
                <dd className={fact.value ? styles.factValue : styles.factEmpty}>{fact.value ?? 'Не указано'}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.note}>
            ФИО, должность, роль и вуз меняет администратор — напишите ему, если что-то неверно.
          </p>
        </Card>
      </Section>

      <Section
        title="Всё, что система знает о вас"
        description="Файл JSON: учётная запись, назначения ответственным, ваши действия в журнале, цели и основания обработки, сроки хранения."
      >
        <Card className={styles.export}>
          <div className={styles.exportText}>
            <p>
              Скачать можно не чаще раза в 10 минут. Каждая выгрузка записывается в журнал действий — так
              требует учёт запросов о персональных данных.
            </p>
          </div>
          <DownloadButton href="/api/me/data-export" fallbackName="skilllink-my-data.json" variant="primary">
            Скачать мои данные
          </DownloadButton>
        </Card>
      </Section>

      <Section title="Что вы меняете сами">
        <ul className={styles.links}>
          <li>
            <Link className={styles.link} href={`${ROUTES.profile}#profile-settings`}>
              <Icon name="lock" size={16} />
              Пароль, каналы уведомлений и режим интерфейса
              <Icon name="chevronRight" size={16} />
            </Link>
          </li>
          <li>
            <Link className={styles.link} href={ROUTES.privacy}>
              <Icon name="document" size={16} />
              Политика обработки персональных данных
              <Icon name="chevronRight" size={16} />
            </Link>
          </li>
        </ul>
      </Section>
    </>
  )
}
