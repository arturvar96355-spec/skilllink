import { getCurrentUser } from '@/shared/auth/current-user'
import { created, handle, okList, parseBody, parseQuery } from '@/shared/http'
import * as service from '@/modules/enrollment/enrollment.service'
import { createSchoolCourseSchema, schoolCourseListQuerySchema } from '@/modules/enrollment/enrollment.schema'

/** Курсы ИТ-Школы с показателями набора: заявки, слушатели, группы (решение 122). */
export const GET = handle(async (request) => {
  const user = await getCurrentUser()
  const query = parseQuery(request, schoolCourseListQuerySchema)
  const { data, meta } = await service.listCourses(user, query)
  return okList(data, meta)
})

/** Завести курс: без него заказы с сайта по этому курсу не загрузятся. */
export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, createSchoolCourseSchema)
  return created(await service.createCourse(user, input))
})
