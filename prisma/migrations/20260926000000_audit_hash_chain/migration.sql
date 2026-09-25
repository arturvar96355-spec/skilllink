-- Журнал действий с защитой от подмены: цепочка хешей (решение 115).
--
-- Каждая строка audit_log получает номер в цепочке (chain_seq: 1, 2, 3… без пропусков),
-- хеш предыдущей строки (prev_hash) и свой хеш (row_hash):
--
--   row_hash = sha256( hex(prev_hash) или 'GENESIS'  ||  '|'  ||  каноническая запись строки )
--
-- Каноническая запись — JSON-массив полей в постоянном порядке (audit_row_canonical):
-- массив, а не строка через разделитель, чтобы «a|b» + «c» и «a» + «b|c» давали разное.
-- Адрес клиента (payload.address) в запись не входит: по сроку (90 дней, решение 88)
-- его стирают, и цепочка от этого ломаться не должна.
--
-- Хеш считает триггер BEFORE INSERT — ни один путь записи (приложение, скрипт, psql)
-- его не обходит. Номер выдаётся под транзакционной рекомендательной блокировкой:
-- две параллельные вставки не получат один номер и не разветвят цепочку. Идентификатор
-- строки (cuid) порядка не задаёт — цепочка идёт по chain_seq.
--
-- UPDATE, DELETE и TRUNCATE журнала запрещены триггером. Обход — только
-- `SET LOCAL skilllink.allow_audit_purge = 'on'` в транзакции: так стирает адрес клиента
-- и чистит журнал по сроку scripts/retention.ts, так же перезаливка демо (prisma/seed.ts).
-- Роли приложения UPDATE и DELETE журнала не выданы вовсе (create-app-role.sql).
--
-- Чистка по сроку удаляет только начало цепочки и записывает точку чистки
-- (audit_chain_cuts): проверка знает, с какого номера и хеша цепочка законно начинается.
-- Пересчитывать цепочку после чистки не нужно.
--
-- Печать (audit_seals) — голова цепочки на момент снятия. Цепочка сама не видит,
-- что у неё отрезали хвост; печать, чья копия лежит вне базы, — видит.
--
-- Существующие строки получают номера и хеши здесь же — в порядке (created_at, id).
-- Таблица на время миграции закрыта на запись: иначе строка, вставленная приложением
-- между заполнением и триггером, осталась бы без номера.
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную; защита журнала теряется,
-- сами записи журнала не затрагиваются):
--   DROP TRIGGER zz_audit_chain_link ON "audit_log";
--   DROP TRIGGER audit_log_append_only ON "audit_log";
--   DROP TRIGGER audit_log_no_truncate ON "audit_log";
--   DROP TABLE "audit_seals"; DROP TABLE "audit_chain_cuts";
--   ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_chain_check",
--     DROP COLUMN "chain_seq", DROP COLUMN "prev_hash", DROP COLUMN "row_hash";
--   ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_fkey",
--     ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id")
--     ON DELETE SET NULL ON UPDATE CASCADE;
--   DROP FUNCTION audit_verify_chain(text), audit_take_seal(text),
--     audit_purge_before(timestamp, boolean, text), audit_chain_install(text),
--     audit_log_chain_link(), audit_append_only_guard(), audit_chain_head(text),
--     audit_chain_lock_key(regclass), audit_row_hash(bytea, text),
--     audit_row_canonical(bigint, text, text, text, text, text, jsonb, timestamp);

LOCK TABLE "audit_log" IN EXCLUSIVE MODE;

-- ───────────────────────────── Колонки и таблицы ─────────────────────────────

-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_fkey";

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "chain_seq" BIGINT,
ADD COLUMN     "prev_hash" BYTEA,
ADD COLUMN     "row_hash" BYTEA;

-- CreateTable
CREATE TABLE "audit_seals" (
    "id" BIGSERIAL NOT NULL,
    "head_seq" BIGINT NOT NULL,
    "head_hash" BYTEA,
    "row_count" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_seals_pkey" PRIMARY KEY ("id"),
    -- Хеш есть ровно у непустой цепочки, и это SHA-256.
    CONSTRAINT "audit_seals_head_check"
      CHECK ("head_seq" >= 0 AND ("head_seq" = 0) = ("head_hash" IS NULL)
             AND ("head_hash" IS NULL OR octet_length("head_hash") = 32) AND "row_count" >= 0)
);

-- CreateTable
CREATE TABLE "audit_chain_cuts" (
    "id" BIGSERIAL NOT NULL,
    "cut_seq" BIGINT NOT NULL,
    "cut_hash" BYTEA NOT NULL,
    "deleted_rows" BIGINT NOT NULL,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_chain_cuts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_chain_cuts_check"
      CHECK ("cut_seq" > 0 AND octet_length("cut_hash") = 32 AND "deleted_rows" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_chain_cuts_cut_seq_key" ON "audit_chain_cuts"("cut_seq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_chain_seq_key" ON "audit_log"("chain_seq");

-- AddForeignKey
-- RESTRICT вместо SET NULL: обнуление автора — это правка журнала, её не пропустит триггер.
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────────────────────── Хеш строки ─────────────────────────────

-- Каноническая запись строки. Первый элемент — версия формата: если формат
-- придётся менять, старые строки останутся проверяемыми по своей версии.
-- Время — UTC с микросекундами (колонка без часового пояса, приложение пишет UTC,
-- от настройки TimeZone сеанса to_char для timestamp не зависит).
-- Зеркало на TypeScript — auditCanonical() в src/modules/audit/chain.rules.ts.
CREATE FUNCTION audit_row_canonical(
  p_chain_seq bigint, p_id text, p_user_id text, p_action text,
  p_object_type text, p_object_id text, p_payload jsonb, p_created_at timestamp
) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT json_build_array(
    'v1',
    p_chain_seq::text,
    p_id,
    p_user_id,
    p_action,
    p_object_type,
    p_object_id,
    CASE WHEN jsonb_typeof(p_payload) = 'object' THEN (p_payload - 'address')::text
         ELSE p_payload::text END,
    to_char(p_created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text
$$;

-- SHA-256 от хеша предыдущей строки (hex, у первой — 'GENESIS') и канонической записи.
CREATE FUNCTION audit_row_hash(p_prev_hash bytea, p_canonical text) RETURNS bytea
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT sha256(convert_to(coalesce(encode(p_prev_hash, 'hex'), 'GENESIS') || '|' || p_canonical, 'UTF8'))
$$;

-- Ключ рекомендательной блокировки цепочки: 115 (номер решения) в старших 32 битах,
-- oid таблицы — в младших. Своя блокировка у каждой таблицы журнала: временная
-- схема теста не мешает настоящему журналу.
CREATE FUNCTION audit_chain_lock_key(p_table regclass) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT (115::bigint << 32) | p_table::oid::bigint $$;

-- Голова цепочки в схеме: последняя строка журнала или, если журнал вычищен
-- по сроку до конца, последняя точка чистки. Пустая цепочка — (0, NULL).
CREATE FUNCTION audit_chain_head(p_schema text, OUT head_seq bigint, OUT head_hash bytea)
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_cut_seq bigint;
  v_cut_hash bytea;
BEGIN
  EXECUTE format(
    'SELECT chain_seq, row_hash FROM %I.audit_log WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1',
    p_schema) INTO head_seq, head_hash;
  EXECUTE format('SELECT cut_seq, cut_hash FROM %I.audit_chain_cuts ORDER BY cut_seq DESC LIMIT 1', p_schema)
    INTO v_cut_seq, v_cut_hash;
  IF head_seq IS NULL OR (v_cut_seq IS NOT NULL AND v_cut_seq > head_seq) THEN
    head_seq := coalesce(v_cut_seq, 0);
    head_hash := v_cut_hash;
  END IF;
END
$$;

-- ───────────────────────────── Триггеры ─────────────────────────────

-- Сцепление новой строки. Значения chain_seq, prev_hash, row_hash из INSERT
-- перезаписываются всегда. Блокировка держится до конца транзакции вставки:
-- следующая вставка увидит эту строку уже зафиксированной.
-- Имя с «zz_»: BEFORE-триггеры срабатывают по алфавиту, а этот должен быть последним —
-- триггер, поменявший строку после подсчёта хеша, сломал бы её проверку.
CREATE FUNCTION audit_log_chain_link() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_head record;
BEGIN
  PERFORM pg_advisory_xact_lock(public.audit_chain_lock_key(TG_RELID));
  SELECT * INTO v_head FROM public.audit_chain_head(TG_TABLE_SCHEMA);
  NEW.chain_seq := v_head.head_seq + 1;
  NEW.prev_hash := v_head.head_hash;
  NEW.row_hash := public.audit_row_hash(
    NEW.prev_hash,
    public.audit_row_canonical(NEW.chain_seq, NEW.id, NEW.user_id, NEW.action,
                               NEW.object_type, NEW.object_id, NEW.payload, NEW.created_at));
  RETURN NEW;
END
$$;

-- Журнал, печати и точки чистки только дописываются.
CREATE FUNCTION audit_append_only_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_setting('skilllink.allow_audit_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Таблица % только дописывается: % запрещён', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Чистка по сроку — npm run db:retention; осознанный обход — SET LOCAL skilllink.allow_audit_purge = ''on'' (решение 115).';
END
$$;

-- Триггеры на таблицы журнала в схеме. Здесь — для public; тест цепочки ставит
-- ими же триггеры во временной схеме, чтобы проверять ровно эту установку.
CREATE FUNCTION audit_chain_install(p_schema text) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_table text;
BEGIN
  EXECUTE format(
    'CREATE TRIGGER zz_audit_chain_link BEFORE INSERT ON %I.audit_log
       FOR EACH ROW EXECUTE FUNCTION public.audit_log_chain_link()', p_schema);
  FOREACH v_table IN ARRAY ARRAY['audit_log', 'audit_seals', 'audit_chain_cuts'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION public.audit_append_only_guard()',
      v_table || '_append_only', p_schema, v_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I.%I
         FOR EACH STATEMENT EXECUTE FUNCTION public.audit_append_only_guard()',
      v_table || '_no_truncate', p_schema, v_table);
  END LOOP;
END
$$;

-- ───────────────────────────── Проверка ─────────────────────────────

-- Проверка цепочки. Идёт по chain_seq от точки последней чистки:
--   rows_missing       — пропуск номеров: строки удалены;
--   row_before_cut     — строка с номером из вычищенной части;
--   link_broken        — prev_hash не равен row_hash предыдущей: строка удалена
--                        с перенумерацией, переставлена или хеш предыдущей пересчитан;
--   row_modified       — row_hash не сходится с содержимым: строка изменена;
--   row_unnumbered     — строка без номера или хеша (вставлена в обход триггера).
-- Затем — печати: каждая печать новее точки чистки должна находить свою строку с тем же хешем:
--   tail_removed       — печать видела строку дальше нынешней головы: отрезан хвост;
--   history_rewritten  — хеш строки печати другой: история переписана и пересчитана.
-- Возвращает первое нарушение. STABLE — все запросы видят один снимок базы.
-- Зеркало на TypeScript — createChainVerifier() и checkSeal() в chain.rules.ts.
CREATE FUNCTION audit_verify_chain(p_schema text DEFAULT 'public')
RETURNS TABLE (
  ok boolean, checked bigint, code text, broken_seq bigint, broken_id text, reason text,
  head_seq bigint, head_hash text, anchor_seq bigint, seals_checked bigint
)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_anchor_seq bigint := 0;
  v_anchor_hash bytea;
  v_expected bigint;
  v_prev bytea;
  v_last_seq bigint;
  v_last_hash bytea;
  v_checked bigint := 0;
  v_seals bigint := 0;
  v_hash bytea;
  r record;
  s record;
BEGIN
  EXECUTE format('SELECT cut_seq, cut_hash FROM %I.audit_chain_cuts ORDER BY cut_seq DESC LIMIT 1', p_schema)
    INTO v_anchor_seq, v_anchor_hash;
  v_anchor_seq := coalesce(v_anchor_seq, 0);
  v_expected := v_anchor_seq + 1;
  v_prev := v_anchor_hash;
  v_last_seq := v_anchor_seq;
  v_last_hash := v_anchor_hash;

  FOR r IN EXECUTE format(
    'SELECT id, user_id, action, object_type, object_id, payload, created_at, chain_seq, prev_hash, row_hash
       FROM %I.audit_log ORDER BY chain_seq NULLS FIRST', p_schema)
  LOOP
    code := NULL;
    IF r.chain_seq IS NULL OR r.row_hash IS NULL THEN
      code := 'row_unnumbered';
      reason := 'Строка без номера или хеша цепочки: вставлена в обход триггера';
    ELSIF r.chain_seq < v_expected THEN
      code := 'row_before_cut';
      reason := format('Строка № %s — из части журнала, вычищенной по сроку (до № %s)', r.chain_seq, v_anchor_seq);
    ELSIF r.chain_seq > v_expected THEN
      code := 'rows_missing';
      reason := CASE WHEN r.chain_seq = v_expected + 1
        THEN format('Удалена строка № %s', v_expected)
        ELSE format('Удалены строки № %s–%s', v_expected, r.chain_seq - 1) END;
    ELSIF r.prev_hash IS DISTINCT FROM v_prev THEN
      code := 'link_broken';
      reason := format('Строка № %s не ссылается на предыдущую: строка перед ней удалена, переставлена или пересчитана', r.chain_seq);
    ELSE
      v_hash := public.audit_row_hash(r.prev_hash,
        public.audit_row_canonical(r.chain_seq, r.id, r.user_id, r.action, r.object_type,
                                   r.object_id, r.payload, r.created_at));
      IF v_hash <> r.row_hash THEN
        code := 'row_modified';
        reason := format('Строка № %s изменена после записи', r.chain_seq);
      END IF;
    END IF;

    IF code IS NOT NULL THEN
      ok := false; checked := v_checked; broken_seq := r.chain_seq; broken_id := r.id;
      head_seq := v_last_seq; head_hash := encode(v_last_hash, 'hex');
      anchor_seq := v_anchor_seq; seals_checked := 0;
      RETURN NEXT;
      RETURN;
    END IF;

    v_checked := v_checked + 1;
    v_expected := r.chain_seq + 1;
    v_prev := r.row_hash;
    v_last_seq := r.chain_seq;
    v_last_hash := r.row_hash;
  END LOOP;

  FOR s IN EXECUTE format('SELECT id, head_seq, head_hash, created_at FROM %I.audit_seals ORDER BY id', p_schema)
  LOOP
    code := NULL;
    IF s.head_seq > v_last_seq THEN
      code := 'tail_removed';
      reason := format('Печать № %s видела строку № %s, а журнал кончается на № %s: удалён хвост журнала',
                       s.id, s.head_seq, v_last_seq);
    ELSIF s.head_seq > v_anchor_seq THEN
      EXECUTE format('SELECT row_hash FROM %I.audit_log WHERE chain_seq = $1', p_schema) INTO v_hash USING s.head_seq;
      IF v_hash IS DISTINCT FROM s.head_hash THEN
        code := 'history_rewritten';
        reason := format('Хеш строки № %s не совпадает с печатью № %s: история журнала переписана', s.head_seq, s.id);
      END IF;
    ELSIF s.head_seq = v_anchor_seq AND v_anchor_seq > 0 THEN
      IF s.head_hash IS DISTINCT FROM v_anchor_hash THEN
        code := 'history_rewritten';
        reason := format('Точка чистки № %s не совпадает с печатью № %s: история журнала переписана', v_anchor_seq, s.id);
      END IF;
    ELSE
      -- Печать указывает в вычищенную по сроку часть: сверять не с чем.
      CONTINUE;
    END IF;

    IF code IS NOT NULL THEN
      ok := false; checked := v_checked; broken_seq := s.head_seq; broken_id := NULL;
      head_seq := v_last_seq; head_hash := encode(v_last_hash, 'hex');
      anchor_seq := v_anchor_seq; seals_checked := v_seals;
      RETURN NEXT;
      RETURN;
    END IF;
    v_seals := v_seals + 1;
  END LOOP;

  ok := true; checked := v_checked; code := NULL; broken_seq := NULL; broken_id := NULL; reason := NULL;
  head_seq := v_last_seq; head_hash := encode(v_last_hash, 'hex');
  anchor_seq := v_anchor_seq; seals_checked := v_seals;
  RETURN NEXT;
END
$$;

-- ───────────────────────────── Печать и чистка ─────────────────────────────

-- Снять печать: голова цепочки и число строк. Под той же блокировкой, что и вставка:
-- печать не застанет строку, которая уже получила номер, но ещё не зафиксирована.
CREATE FUNCTION audit_take_seal(p_schema text DEFAULT 'public')
RETURNS TABLE (id bigint, head_seq bigint, head_hash bytea, row_count bigint, created_at timestamp)
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_head record;
  v_count bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(public.audit_chain_lock_key(format('%I.audit_log', p_schema)::regclass));
  SELECT * INTO v_head FROM public.audit_chain_head(p_schema);
  EXECUTE format('SELECT count(*) FROM %I.audit_log', p_schema) INTO v_count;
  RETURN QUERY EXECUTE format(
    'INSERT INTO %I.audit_seals (head_seq, head_hash, row_count, created_at)
     VALUES ($1, $2, $3, now() AT TIME ZONE ''UTC'')
     RETURNING id, head_seq, head_hash, row_count, created_at::timestamp', p_schema)
    USING v_head.head_seq, v_head.head_hash, v_count;
END
$$;

-- Чистка по сроку хранения: удаляет НАЧАЛО цепочки — строки до первой строки
-- не старше p_cutoff — и записывает точку чистки. Строка старше срока, стоящая
-- в цепочке после более свежей (долгая транзакция), доживёт до следующего запуска.
-- Голова цепочки не удаляется никогда: следующей вставке нужен её хеш.
-- p_apply = false — только посчитать. older_kept — сколько строк старше срока остаётся.
CREATE FUNCTION audit_purge_before(p_cutoff timestamp, p_apply boolean DEFAULT false, p_schema text DEFAULT 'public')
RETURNS TABLE (cut_seq bigint, deleted bigint, older_kept bigint)
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_head bigint;
  v_keep_from bigint;
  v_cut bigint;
  v_cut_hash bytea;
  v_deleted bigint := 0;
  v_older bigint := 0;
  v_bypass text;
BEGIN
  IF p_apply THEN
    PERFORM pg_advisory_xact_lock(public.audit_chain_lock_key(format('%I.audit_log', p_schema)::regclass));
  END IF;
  EXECUTE format('SELECT max(chain_seq) FROM %I.audit_log', p_schema) INTO v_head;
  IF v_head IS NULL THEN
    RETURN QUERY SELECT NULL::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;
  EXECUTE format('SELECT min(chain_seq) FROM %I.audit_log WHERE created_at >= $1', p_schema)
    INTO v_keep_from USING p_cutoff;
  v_keep_from := least(coalesce(v_keep_from, v_head), v_head);
  EXECUTE format('SELECT chain_seq, row_hash FROM %I.audit_log WHERE chain_seq < $1 ORDER BY chain_seq DESC LIMIT 1', p_schema)
    INTO v_cut, v_cut_hash USING v_keep_from;
  EXECUTE format('SELECT count(*) FROM %I.audit_log WHERE created_at < $1 AND chain_seq >= $2', p_schema)
    INTO v_older USING p_cutoff, v_keep_from;
  IF v_cut IS NULL THEN
    RETURN QUERY SELECT NULL::bigint, 0::bigint, v_older;
    RETURN;
  END IF;
  IF NOT p_apply THEN
    EXECUTE format('SELECT count(*) FROM %I.audit_log WHERE chain_seq <= $1', p_schema) INTO v_deleted USING v_cut;
    RETURN QUERY SELECT v_cut, v_deleted, v_older;
    RETURN;
  END IF;

  v_bypass := current_setting('skilllink.allow_audit_purge', true);
  PERFORM set_config('skilllink.allow_audit_purge', 'on', true);
  EXECUTE format('DELETE FROM %I.audit_log WHERE chain_seq <= $1', p_schema) USING v_cut;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM set_config('skilllink.allow_audit_purge', coalesce(v_bypass, ''), true);

  EXECUTE format(
    'INSERT INTO %I.audit_chain_cuts (cut_seq, cut_hash, deleted_rows, cutoff, created_at)
     VALUES ($1, $2, $3, $4, now() AT TIME ZONE ''UTC'')', p_schema)
    USING v_cut, v_cut_hash, v_deleted, p_cutoff;
  RETURN QUERY SELECT v_cut, v_deleted, v_older;
END
$$;

-- Чистить журнал и ставить триггеры может только владелец. Роли приложения и так
-- не выдано DELETE журнала (create-app-role.sql) — это второй замок.
REVOKE EXECUTE ON FUNCTION audit_purge_before(timestamp, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION audit_chain_install(text) FROM PUBLIC;

-- ───────────────────────────── Существующие строки ─────────────────────────────

DO $$
DECLARE
  r record;
  v_seq bigint := 0;
  v_prev bytea;
  v_hash bytea;
BEGIN
  FOR r IN SELECT * FROM "audit_log" ORDER BY "created_at", "id" LOOP
    v_seq := v_seq + 1;
    v_hash := audit_row_hash(v_prev, audit_row_canonical(v_seq, r.id, r.user_id, r.action,
                                                         r.object_type, r.object_id, r.payload, r.created_at));
    UPDATE "audit_log" SET "chain_seq" = v_seq, "prev_hash" = v_prev, "row_hash" = v_hash WHERE "id" = r.id;
    v_prev := v_hash;
  END LOOP;
END
$$;

-- Номер и хеш есть у каждой строки; у первой строки цепочки (и только у неё) нет prev_hash.
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_chain_check"
  CHECK ("chain_seq" IS NOT NULL AND "chain_seq" > 0
         AND "row_hash" IS NOT NULL AND octet_length("row_hash") = 32
         AND ("prev_hash" IS NULL OR octet_length("prev_hash") = 32)
         AND ("prev_hash" IS NULL) = ("chain_seq" = 1));

SELECT audit_chain_install('public');
