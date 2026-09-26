# Мониторинг: Prometheus и Grafana (решение 137)

Метрики сервера — `GET /api/metrics` (docs/API_CONTRACT.md), формат Prometheus 0.0.4.
Список метрик и правила оповещений: `deploy/monitoring/alert-rules.yml`. Это не
обязательная часть стенда — профиль `monitoring` **по умолчанию выключен**
(docs/SECURITY_LIMITATIONS.md, docs/DEPLOY.md): боевая машина рассчитана на 2 ГБ
памяти, и Prometheus с Grafana съедят заметную её часть. Включает владелец осознанно.

## Что где

| Файл | Что делает |
| --- | --- |
| `prometheus.yml` | Опрашивает `app:3000/api/metrics` каждые 15 с по токену; грузит правила |
| `alert-rules.yml` | Правила оповещений — 5xx, p95, база, копия, всплески 429 и неудачных входов, задержка цикла событий |
| `metrics-token` | Токен для Prometheus — **не в git**, см. ниже |
| `grafana/provisioning/` | Источник данных и провайдер дашборда — подключаются сами при старте |
| `grafana/skilllink.json` | Дашборд: RPS и доля 5xx, p50/p95/p99, отказы 429 и неудачные входы, память, задержка цикла событий, база и пул соединений, ночная копия |

## Как включить (локально или на сервере — решение владельца)

1. Токен метрик — то же значение в `METRICS_TOKEN` приложения и в файле, который
   читает Prometheus:

   ```bash
   cp deploy/monitoring/metrics-token.example deploy/monitoring/metrics-token
   # впишите в файл то же значение, что METRICS_TOKEN в .env / .env.cloud
   ```

2. Пароль Grafana — обязателен, без него `docker compose` откажется стартовать
   (`GF_SECURITY_ADMIN_PASSWORD` пуст — публичный порт с `admin/admin`):

   ```bash
   export GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 12)
   echo "Пароль Grafana: $GRAFANA_ADMIN_PASSWORD"   # сохраните — второй раз не покажет
   ```

3. Поднять профиль (вместе с приложением — Prometheus опрашивает его по имени
   сервиса `app`):

   ```bash
   docker compose --profile app --profile monitoring up -d
   ```

4. Проверить: Prometheus — http://localhost:9090/targets (цель `skilllink-app`
   должна быть `UP`); Grafana — http://localhost:3001 (вход `admin` / пароль из
   шага 2), дашборд «SkillLink» уже на месте.

Порты только на `127.0.0.1` (та же причина, что у базы и приложения — docker-compose.yml):
снаружи Prometheus и Grafana не открыты, даже если профиль включат на сервере.

## Проверка без запуска Prometheus

Синтаксис правил и конфигурации — образом Prometheus, без установки:

```bash
docker run --rm -v "$PWD/deploy/monitoring:/etc/prometheus" --entrypoint /bin/promtool \
  prom/prometheus:v2.55.1 check config /etc/prometheus/prometheus.yml
```

(Требует, чтобы `deploy/monitoring/metrics-token` уже существовал — шаг 1 выше;
содержимое не важно, `check config` его не читает.)

## На сервере (2 ГБ, профиль выключен по умолчанию)

Если решите включить: добавьте `mem_limit` в `deploy/yandex-cloud/compose.cloud.yml`
для `prometheus` и `grafana` (по образцу остальных сервисов) и следите за свободной
памятью (`/api/metrics` — `process_resident_memory_bytes` самого приложения; для
Prometheus и Grafana — `docker stats`). Держать оба контейнера постоянно на боевой
машине без явного решения владельца не стоит — раздел 6 docs/DEPLOY.md.
