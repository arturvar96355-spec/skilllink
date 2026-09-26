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
export { ListTitle } from './data/ListTitle'
export { mockMarks, type MockMarks } from './data/origin'
export { KpiCard, KpiRow, KpiStrip, MetricValue, MetricCell, type KpiStripItem } from './data/Metric'
export {
  UniversityStatusBadge,
  ProgramStatusBadge,
  CooperationStatusBadge,
  StageStatusBadge,
  DocumentStatusBadge,
  PriorityBadge,
  RecommendationStatusBadge,
  TransferStatusBadge,
  DeadlineBadge,
} from './data/status'

export { Modal } from './overlays/Modal'
export { Drawer } from './overlays/Drawer'
export { ToastProvider, useToast } from './overlays/Toast'

export { AppShell } from './layout/AppShell'
export { NAV_TRANSITION_ATTRIBUTE } from './layout/navigation-motion'
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
export { UiModeSwitch } from './layout/UiModeSwitch'

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
  useIsTruncated,
} from './hooks/dom'
export { usePageInRange } from './hooks/page-range'
export { useUiMode, useCalmMotion, setUiMode } from './hooks/ui-mode'
export { useReveal } from './hooks/reveal'
export { useTheme, setTheme } from './hooks/theme'
export { ThemeToggle } from './layout/ThemeToggle'
export { UI_MODE_LABELS, type UiMode } from './lib/ui-mode'

export {
  apiDelete,
  apiGet,
  apiGetRaw,
  apiPatch,
  apiPost,
  apiPut,
  apiUpload,
  buildQuery,
  fieldErrors,
  ApiRequestError,
} from './lib/api'
export { ATTACHMENT_ACCEPT, ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_MB } from './lib/attachments'
export {
  NO_DATA,
  formatNumber,
  formatScore,
  formatPercent,
  formatShare,
  formatPlace,
  formatDemand,
  formatMetric,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatFileSize,
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
  formatPersonShort,
  firstNameOf,
  abbreviate,
} from './lib/format'
export {
  ROUTES,
  API_CONTRACT_URL,
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
export { startMorph } from './lib/morph'
export { TagCarousel, type TagCarouselProps } from './data/TagCarousel'
export { Funnel, type FunnelStep } from './data/Funnel'
export { FactSheet, type Fact } from './data/FactSheet'
export { Ring } from './data/Ring'
export { Pie3D, type Pie3DSlice, type Pie3DTone } from './data/Pie3D'
export { Bars3D, type Bars3DGroup, type Bars3DPart } from './data/Bars3D'
export { PeekProvider, usePeek, CooperationPeek } from './data/Peek'
export { DeadlineStrip, type DeadlineItem } from './data/DeadlineStrip'
export { StageBar } from './data/StageBar'
export { ScoreBar, ScoreLegend, type ScorePart } from './data/ScoreBar'
export { GapBars, type GapRow } from './data/GapBars'
export { ResetFilters, useResetUrl } from './data/ResetFilters'
export { OPEN_RECOMMENDATION_STATUSES, CLOSED_RECOMMENDATION_STATUSES } from './lib/recommendation-scope'
export { RussiaMap, type MapPoint } from './data/RussiaMap'
export { Ticker, type TickerItem } from './data/Ticker'
export { Radar, type RadarAxis, type RadarSeries } from './data/Radar'
