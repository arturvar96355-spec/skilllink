'use client'

import { useState } from 'react'
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type CooperationListItemDto,
  type DocumentDto,
  type DocumentType,
  type ProgramListItemDto,
  type UniversityListItemDto,
  type UserDto,
} from '@/shared/contracts'
import {
  Button,
  Input,
  Modal,
  RemoteSelect,
  Select,
  apiPost,
  cooperationOption,
  fieldErrors,
  programWithUniversityOption,
  universityShortOption,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import { buildCreateDocumentInput } from './document-create'

/**
 * Добавление документа вручную (задача «Данные без экрана», пункт 3):
 * `POST /api/documents` принимает метаданные и ссылку с самого начала
 * (решение 14 — файлы в MVP не хранятся, только реквизиты и внешняя ссылка),
 * но завести документ можно было только сборкой пакета по шаблону или через
 * `/api-docs`. Договор, присланный вузом без шаблона, занести было некуда.
 *
 * Если модалка открыта со страницы связки, привязка к ней уже известна —
 * поля вуза, программы и связки не показываются вовсе. В общем разделе
 * «Документы» привязка выбирается той же цепочкой RemoteSelect, что у фильтров
 * реестра (вуз → программа → связка); все три поля необязательны, как и в схеме.
 */
export function CreateDocumentModal({
  cooperationId,
  onClose,
}: {
  /** Есть — документ сразу привязан к этой связке, поля привязки не показываются. */
  cooperationId?: string
  onClose: (created: DocumentDto | null) => void
}) {
  const toast = useToast()
  const hasFixedLink = cooperationId !== undefined

  const [type, setType] = useState<DocumentType>('AGREEMENT')
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState('1')
  const [fileReference, setFileReference] = useState('')
  const [responsibleId, setResponsibleId] = useState('')
  const [issuedAt, setIssuedAt] = useState('')

  const [universityId, setUniversityId] = useState('')
  const [programId, setProgramId] = useState('')
  const [pickedCooperationId, setPickedCooperationId] = useState('')

  const users = useResource<UserDto[]>('/api/users?pageSize=100')

  const save = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPost<DocumentDto>('/api/documents', body)
    return result.data
  })

  const errors = fieldErrors(save.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const body = buildCreateDocumentInput(
      { type, title, version, fileReference, responsibleId, issuedAt },
      {
        cooperationId: hasFixedLink ? (cooperationId ?? '') : pickedCooperationId,
        universityId: hasFixedLink ? '' : universityId,
        programId: hasFixedLink ? '' : programId,
      },
    )
    const result = await save.run(body)

    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }

    toast.success(`Документ «${result.data.title}» добавлен`)
    onClose(result.data)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      title="Добавить документ"
      description="Реквизиты и ссылка на внешний файл — загрузка файлов в систему не реализована (решение 14)."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(null)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={save.isPending} disabled={title.trim() === ''}>
            Добавить
          </Button>
        </>
      }
    >
      <Select
        label="Тип документа"
        required
        value={type}
        onValueChange={(value) => setType(value as DocumentType)}
        options={DOCUMENT_TYPES.map((value) => ({ value, label: DOCUMENT_TYPE_LABELS[value] }))}
        error={errorFor('type')}
      />
      <Input
        label="Название"
        required
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        error={errorFor('title')}
        placeholder="Договор о сотрудничестве"
        maxLength={300}
        autoFocus
      />
      <Input
        label="Версия"
        value={version}
        onChange={(event) => setVersion(event.target.value)}
        error={errorFor('version')}
        placeholder="1"
        maxLength={50}
      />
      <Input
        label="Ссылка на документ"
        type="url"
        value={fileReference}
        onChange={(event) => setFileReference(event.target.value)}
        error={errorFor('fileReference')}
        placeholder="https://disk.example.ru/dogovor.pdf"
        hint="Адрес с http:// или https://; необязательно."
      />
      <Input
        label="Дата выдачи"
        type="date"
        value={issuedAt}
        onChange={(event) => setIssuedAt(event.target.value)}
        error={errorFor('issuedAt')}
      />
      <Select
        label="Ответственный"
        value={responsibleId}
        onValueChange={setResponsibleId}
        placeholder={users.isLoading ? 'Загрузка…' : 'Не назначен'}
        options={(users.data ?? []).map((row) => ({ value: row.id, label: row.fullName }))}
        error={errorFor('responsibleId')}
      />

      {!hasFixedLink && (
        <>
          <RemoteSelect<UniversityListItemDto>
            label="Вуз"
            endpoint="/api/universities"
            params={{ withRating: 'false', sort: 'name' }}
            toOption={universityShortOption}
            placeholder="Не привязан"
            value={universityId}
            onValueChange={(value) => {
              setUniversityId(value)
              setProgramId('')
              setPickedCooperationId('')
            }}
          />
          <RemoteSelect<ProgramListItemDto>
            label="Программа"
            endpoint="/api/programs"
            params={{ universityId: universityId || undefined, sort: 'name' }}
            toOption={universityId ? (row) => ({ value: row.id, label: row.name }) : programWithUniversityOption}
            placeholder="Не привязана"
            value={programId}
            onValueChange={(value) => {
              setProgramId(value)
              setPickedCooperationId('')
            }}
          />
          <RemoteSelect<CooperationListItemDto>
            label="Связка"
            endpoint="/api/cooperations"
            params={{ universityId: universityId || undefined, programId: programId || undefined }}
            toOption={cooperationOption}
            searchPlaceholder="Вуз или программа"
            placeholder="Не привязан"
            value={pickedCooperationId}
            onValueChange={setPickedCooperationId}
            error={errorFor('cooperationId')}
          />
        </>
      )}
    </Modal>
  )
}
