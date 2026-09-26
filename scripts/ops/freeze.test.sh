#!/usr/bin/env bash
# Проверка логики заморозки после сдачи (STAND_FREEZE_AT, решение 147) — на своей
# машине, без ожидания настоящей даты. Как ALERT_DRY_RUN у alert.sh (docs/OPERATIONS_TESTS.md):
# NOW_OVERRIDE подставляет время вместо настоящего.
#
#   bash scripts/ops/freeze.test.sh
#
# Не запускается cron'ом и не входит в demo:check — ручная/CI-проверка изменений
# is_frozen/iso_epoch в ops-lib.sh. Код выхода: 0 — все проверки прошли, 1 — нет.
set -uo pipefail

# shellcheck source=scripts/ops/ops-lib.sh
. "$(dirname "$0")/ops-lib.sh"

FREEZE_AT='2026-09-29T23:59:00+03:00' # = 2026-09-29T20:59:00Z, тот же момент, что в .env.cloud.example
FAILED=0

check() {
  local name=$1 expect_frozen=$2
  if is_frozen "$FREEZE_AT"; then actual=frozen; else actual=not-frozen; fi
  if { [ "$expect_frozen" = frozen ] && [ "$actual" = frozen ]; } ||
    { [ "$expect_frozen" = not-frozen ] && [ "$actual" = not-frozen ]; }; then
    printf 'OK   %s\n' "$name"
  else
    printf 'FAIL %s: ожидали %s, вышло %s\n' "$name" "$expect_frozen" "$actual"
    FAILED=1
  fi
}

unset NOW_OVERRIDE
if is_frozen ""; then
  printf 'FAIL пустой STAND_FREEZE_AT — не должен считаться заморозкой\n'
  FAILED=1
else
  printf 'OK   пустой STAND_FREEZE_AT — не заморожено\n'
fi

if is_frozen 'не дата'; then
  printf 'FAIL нечитаемая дата — не должна считаться заморозкой (fail-safe)\n'
  FAILED=1
else
  printf 'OK   нечитаемая дата — не заморожено (fail-safe)\n'
fi

NOW_OVERRIDE=$(iso_epoch '2020-01-01T00:00:00Z')
check 'далеко в прошлом от момента заморозки (сейчас = 2020)' not-frozen

NOW_OVERRIDE=$(iso_epoch '2026-09-29T20:58:59Z') # на секунду раньше
check 'за секунду до момента заморозки' not-frozen

NOW_OVERRIDE=$(iso_epoch '2026-09-29T20:59:00Z') # ровно момент
check 'ровно в момент заморозки' frozen

NOW_OVERRIDE=$(iso_epoch '2026-09-29T20:59:01Z') # на секунду позже
check 'через секунду после заморозки' frozen

NOW_OVERRIDE=$(iso_epoch '2026-10-14T21:00:00Z') # конец экспертизы — заморозка не снимается сама
check 'заморозка не снимается сама после конца экспертизы' frozen

if [ "$FAILED" -eq 0 ]; then
  printf '\nВсе проверки заморозки прошли.\n'
else
  printf '\nЕсть расхождения — см. FAIL выше.\n'
fi
exit "$FAILED"
