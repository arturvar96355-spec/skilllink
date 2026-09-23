/**
 * Дизайн-система SkillLink.
 *
 * Страницы берут компоненты отсюда и не описывают собственных кнопок, карточек
 * и таблиц: правило «один компонент → один вид → одно поведение» (раздел 35
 * документа об интерфейсе) держится только так.
 */

export { Icon, type IconName } from './primitives/Icon'
export { Button, type ButtonProps } from './primitives/Button'
export { IconButton } from './primitives/IconButton'
export { Badge, MockBadge, type BadgeTone } from './primitives/Badge'
export { Card } from './primitives/Card'
export { Progress } from './primitives/Progress'
export { Skeleton, SkeletonLines } from './primitives/Skeleton'
export { Avatar } from './primitives/Avatar'
export { Tooltip } from './primitives/Tooltip'
export { Field, Input, Textarea, Checkbox, Toggle } from './primitives/Form'
export { Select, type SelectOption } from './primitives/Select'
export { RemoteSelect } from './data/RemoteSelect'
export {
  cooperationOption,
  programWithUniversityOption,
  universityFullOption,
  universityShortOption,
} from './lib/options'

export { EmptyState, ErrorState, CardsSkeleton, TableSkeleton } from './data/States'
export { DataTable, Pagination, CellText, type Column } from './data/Table'
export { KpiCard, KpiStrip, MetricValue, MetricCell, type KpiStripItem } from './data/Metric'
export {
  UniversityStatusBadge,
  ProgramStatusBadge,
  CooperationStatusBadge,
  StageStatusBadge,
  DocumentStatusBadge,
  PriorityBadge,
  RecommendationStatusBadge,
  DeadlineBadge,
} from './data/status'

export { Modal } from './overlays/Modal'
export { Drawer } from './overlays/Drawer'
export { ToastProvider, useToast } from './overlays/Toast'

export { AppShell } from './layout/AppShell'
export { useCurrentUser, isUniversityRep } from './layout/CurrentUser'
export {
  PageHeader,
  Section,
  Breadcrumbs,
  Toolbar,
  ToolbarItem,
  ToolbarSearch,
  Tabs,
  PageContent,
  BackLink,
  type Crumb,
  type TabItem,
} from './layout/Page'
export { Logo } from './layout/Logo'

export { useResource, type Resource } from './hooks/useResource'
export { useMutation, type MutationResult } from './hooks/useMutation'
export {
  useDebounced,
  useEscape,
  useOutsideClick,
  useStoredValue,
  useMediaQuery,
  useCountUp,
  usePrefersReducedMotion,
} from './hooks/dom'
export { usePageInRange } from './hooks/page-range'

export { apiGet, apiPatch, apiPost, apiPut, buildQuery, fieldErrors, ApiRequestError } from './lib/api'
export {
  NO_DATA,
  formatNumber,
  formatScore,
  formatPercent,
  formatMetric,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatRelative,
  formatCount,
  deadlineBadgeText,
  formatDeadlineDistance,
  dateInputToIso,
  dateTimeInputToIso,
  dateToDateTimeInput,
  isoToDateInput,
  pluralize,
  initials,
  abbreviate,
} from './lib/format'
export {
  ROUTES,
  universityHref,
  programHref,
  cooperationHref,
  documentHref,
  recommendationHref,
  productHref,
  skillHref,
  searchItemHref,
  notificationHref,
  recommendationTargetHref,
} from './lib/links'
export { describeRelatedData, type RelatedFact } from './lib/related-data'
