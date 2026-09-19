-- =====================================================================
-- 001_selfstudy_schema.sql
-- maritime-app-selfstudy 전용 DB 객체 (테이블 3개 + RPC 7개)
--
-- 대상 Supabase project ref: fvpfkgzbztjpfuszybnf (maritime-lms와 공유)
--
-- !! 이 파일은 저장소에 보관만 한다. 자동 적용 금지 !!
--    (supabase db push / migration up 사용 금지)
--    사용자가 전체 DB 백업 후 Supabase 대시보드 SQL Editor에서 직접 실행한다.
--
-- 원칙
--   * 새 객체는 전부 selfstudy_ prefix, public schema
--   * public.questions 는 READ ONLY: FK 참조 + 존재 검증 SELECT 로만 사용
--   * 기존 LMS / PDF 추출기 / exam_results 객체는 어떤 것도 변경하지 않는다
--   * 새 테이블은 RLS ON + anon/authenticated/PUBLIC 직접 권한 전부 회수
--   * 프런트는 아래 SECURITY DEFINER RPC 7개로만 selfstudy 데이터를 읽고 쓴다
--   * 전체가 하나의 트랜잭션: 하나라도 실패하면 전부 롤백
--   * create or replace 를 쓰지 않는다: 같은 이름의 객체가 이미 있으면 실패해야 한다
--     (이후 변경은 002_*.sql 로 추가한다)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 사전 점검 (읽기 전용 catalog 조회). 조건이 어긋나면 예외로 전체 롤백.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.questions') is null then
    raise exception 'preflight: public.questions 테이블이 없습니다.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'public.questions'::regclass
      and c.contype = 'p'
      and array_length(c.conkey, 1) = 1
      and a.attname = 'id'
      and a.atttypid = 'integer'::regtype
  ) then
    raise exception 'preflight: public.questions.id 가 integer 단일 PRIMARY KEY 가 아닙니다.';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'selfstudy\_%'
  ) then
    raise exception 'preflight: public 에 selfstudy_ 로 시작하는 relation 이 이미 있습니다.';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'selfstudy\_%'
  ) then
    raise exception 'preflight: public 에 selfstudy_ 로 시작하는 함수가 이미 있습니다.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. selfstudy_profiles : 학생 식별 (학번 + 이름). 인증이 아니라 식별이다.
--    profile_key 는 앱 내부에서 이후 RPC 접근에 쓰는 값이며 비밀번호/PIN 이 아니다.
-- ---------------------------------------------------------------------
create table public.selfstudy_profiles (
  id              bigint generated always as identity primary key,
  profile_key     uuid not null default gen_random_uuid(),
  student_no      text not null,
  student_name    text not null,
  -- 이름의 모든 공백 제거본: 일반 공백/탭/개행 등 POSIX whitespace + NBSP(U+00A0) + 전각공백(U+3000).
  -- 패턴은 U&'...' (SQL 표준 유니코드 이스케이프 문자열)로 쓴다. 파싱 시점에 상수 문자열이 되므로
  -- 함수 호출이 없어 generated stored column 에 필요한 IMMUTABLE 조건을 확실히 만족한다.
  -- (서버 인코딩이 UTF8 이어야 한다: Supabase 기본값)
  -- !! selfstudy_get_or_create_profile 안의 v_norm 표현식과 문자 하나까지 동일해야 한다 !!
  normalized_name text generated always as (regexp_replace(student_name, U&'[[:space:]\00A0\3000]+', '', 'g')) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint selfstudy_profiles_profile_key_key
    unique (profile_key),
  constraint selfstudy_profiles_student_no_normalized_name_key
    unique (student_no, normalized_name),

  -- 저장값은 항상 "앞뒤 공백 제거된 상태"이고 길이는 student_no 1~20자, student_name 1~50자.
  -- (RPC 가 같은 규칙으로 trim 후 검증하므로 DB CHECK 는 최종 방어선이다)
  constraint selfstudy_profiles_student_no_trimmed_check
    check (student_no = regexp_replace(student_no, U&'^[[:space:]\00A0\3000]+|[[:space:]\00A0\3000]+$', '', 'g')),
  constraint selfstudy_profiles_student_no_length_check
    check (char_length(student_no) between 1 and 20),
  constraint selfstudy_profiles_student_name_trimmed_check
    check (student_name = regexp_replace(student_name, U&'^[[:space:]\00A0\3000]+|[[:space:]\00A0\3000]+$', '', 'g')),
  constraint selfstudy_profiles_student_name_length_check
    check (char_length(student_name) between 1 and 50),
  -- 공백만으로 된 이름 차단 (탭/개행/NBSP/전각공백 포함)
  constraint selfstudy_profiles_normalized_name_not_blank
    check (regexp_replace(student_name, U&'[[:space:]\00A0\3000]+', '', 'g') <> '')
);

-- ---------------------------------------------------------------------
-- 2. selfstudy_wrong_questions : 학생+문제당 1행 (이벤트 로그 아님)
--    active  = 오답소탕 대상, cleared = 격파됨 (행은 삭제하지 않고 보존)
-- ---------------------------------------------------------------------
create table public.selfstudy_wrong_questions (
  id             bigint generated always as identity primary key,
  profile_id     bigint  not null references public.selfstudy_profiles(id) on delete cascade,
  question_id    integer not null references public.questions(id),
  wrong_count    integer not null default 1,
  status         text    not null default 'active',
  first_wrong_at timestamptz not null default now(),
  last_wrong_at  timestamptz not null default now(),
  cleared_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint selfstudy_wrong_questions_profile_question_key
    unique (profile_id, question_id),
  constraint selfstudy_wrong_questions_wrong_count_check
    check (wrong_count >= 1),
  constraint selfstudy_wrong_questions_status_check
    check (status in ('active', 'cleared')),
  -- 추가 안전장치: cleared 인 행만 cleared_at 을 가진다
  constraint selfstudy_wrong_questions_cleared_at_consistent
    check ((status = 'cleared') = (cleared_at is not null))
);

create index selfstudy_wrong_questions_active_idx
  on public.selfstudy_wrong_questions (profile_id, first_wrong_at)
  where status = 'active';

-- ---------------------------------------------------------------------
-- 3. selfstudy_sessions : 학생당 가장 최근 학습 세션 1개 (마지막 위치 복원용)
--    답안은 저장하지 않는다.
-- ---------------------------------------------------------------------
create table public.selfstudy_sessions (
  id                     bigint generated always as identity primary key,
  profile_id             bigint not null references public.selfstudy_profiles(id) on delete cascade,
  track_type             text   not null,
  license_class          text,
  subject                text,
  selected_subjects      text[],
  year                   integer,
  exam_round             text,
  -- 세션은 임시 데이터이므로 문제가 삭제돼도 세션이 questions 삭제를 막지 않게 한다
  current_question_id    integer references public.questions(id) on delete set null,
  current_question_index integer,
  question_ids           integer[],
  updated_at             timestamptz not null default now(),

  constraint selfstudy_sessions_profile_id_key
    unique (profile_id),
  constraint selfstudy_sessions_track_type_check
    check (track_type in ('A', 'B', 'C')),
  constraint selfstudy_sessions_current_question_index_check
    check (current_question_index is null or current_question_index >= 0)
);

-- ---------------------------------------------------------------------
-- 4. RLS + 직접 접근 차단
--    정책을 하나도 만들지 않는다 (RLS ON + 정책 없음 = 일반 롤 전면 거부).
--    SECURITY DEFINER 함수는 소유자(postgres) 권한으로 실행된다.
-- ---------------------------------------------------------------------
alter table public.selfstudy_profiles        enable row level security;
alter table public.selfstudy_wrong_questions enable row level security;
alter table public.selfstudy_sessions        enable row level security;

revoke all on table
  public.selfstudy_profiles,
  public.selfstudy_wrong_questions,
  public.selfstudy_sessions
from public, anon, authenticated;

-- identity 시퀀스도 직접 접근 차단 (새로 만든 자기 객체에 한정)
revoke all on sequence
  public.selfstudy_profiles_id_seq,
  public.selfstudy_wrong_questions_id_seq,
  public.selfstudy_sessions_id_seq
from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. RPC 7개 (모두 SECURITY DEFINER, search_path 고정)
--    profile_key 가 유효하지 않으면 errcode 28000 (PostgREST 403),
--    입력값이 잘못되면 errcode 22023 (PostgREST 400).
-- ---------------------------------------------------------------------

-- 5-1) 프로필 조회 또는 생성
create function public.selfstudy_get_or_create_profile(
  p_student_no   text,
  p_student_name text
)
returns table (
  profile_key  uuid,
  student_no   text,
  student_name text,
  is_new       boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_no     text;
  v_name   text;
  v_norm   text;
  v_row    public.selfstudy_profiles%rowtype;
  v_is_new boolean;
begin
  -- 앞뒤 공백 제거: 테이블 CHECK(*_trimmed_check)와 동일한 패턴
  v_no   := regexp_replace(coalesce(p_student_no,   ''), U&'^[[:space:]\00A0\3000]+|[[:space:]\00A0\3000]+$', '', 'g');
  v_name := regexp_replace(coalesce(p_student_name, ''), U&'^[[:space:]\00A0\3000]+|[[:space:]\00A0\3000]+$', '', 'g');
  -- 이름 정규화: selfstudy_profiles.normalized_name 생성식과 동일한 표현식 (수정 시 반드시 함께 수정)
  v_norm := regexp_replace(v_name, U&'[[:space:]\00A0\3000]+', '', 'g');

  -- 검증 기준은 테이블 CHECK 와 동일: student_no 1~20자, student_name 1~50자(공백만 불가)
  if char_length(v_no) < 1 then
    raise exception 'student_no is required' using errcode = '22023';
  end if;
  if char_length(v_no) > 20 then
    raise exception 'student_no must be at most 20 characters' using errcode = '22023';
  end if;
  if char_length(v_norm) < 1 then
    raise exception 'student_name is required' using errcode = '22023';
  end if;
  if char_length(v_name) > 50 then
    raise exception 'student_name must be at most 50 characters' using errcode = '22023';
  end if;

  select * into v_row
  from public.selfstudy_profiles p
  where p.student_no = v_no and p.normalized_name = v_norm;

  if found then
    v_is_new := false;
  else
    begin
      insert into public.selfstudy_profiles (student_no, student_name)
      values (v_no, v_name)
      returning * into v_row;
      v_is_new := true;
    exception when unique_violation then
      -- 동시 생성 race: 다른 트랜잭션이 먼저 만들었으므로 다시 조회
      select * into v_row
      from public.selfstudy_profiles p
      where p.student_no = v_no and p.normalized_name = v_norm;
      if not found then
        raise;  -- 다른 unique 제약 위반이면 그대로 전달
      end if;
      v_is_new := false;
    end;
  end if;

  return query
    select v_row.profile_key, v_row.student_no, v_row.student_name, v_is_new;
end;
$$;

-- 5-2) 최근 세션 조회 (없으면 0 row)
create function public.selfstudy_get_session(
  p_profile_key uuid
)
returns table (
  track_type             text,
  license_class          text,
  subject                text,
  selected_subjects      text[],
  year                   integer,
  exam_round             text,
  current_question_id    integer,
  current_question_index integer,
  question_ids           integer[],
  updated_at             timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_pid bigint;
begin
  select p.id into v_pid
  from public.selfstudy_profiles p
  where p.profile_key = p_profile_key;

  if v_pid is null then
    raise exception 'invalid profile_key' using errcode = '28000';
  end if;

  return query
    select s.track_type, s.license_class, s.subject, s.selected_subjects,
           s.year, s.exam_round, s.current_question_id, s.current_question_index,
           s.question_ids, s.updated_at
    from public.selfstudy_sessions s
    where s.profile_id = v_pid;
end;
$$;

-- 5-3) 최근 세션 저장 (학생당 1개, 통째로 덮어쓰기)
create function public.selfstudy_save_session(
  p_profile_key            uuid,
  p_track_type             text,
  p_license_class          text,
  p_subject                text    default null,
  p_selected_subjects      text[]  default null,
  p_year                   integer default null,
  p_exam_round             text    default null,
  p_current_question_id    integer default null,
  p_current_question_index integer default null,
  p_question_ids           integer[] default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pid bigint;
begin
  select p.id into v_pid
  from public.selfstudy_profiles p
  where p.profile_key = p_profile_key;

  if v_pid is null then
    raise exception 'invalid profile_key' using errcode = '28000';
  end if;

  if p_track_type is null or p_track_type not in ('A', 'B', 'C') then
    raise exception 'track_type must be A, B or C' using errcode = '22023';
  end if;

  if p_current_question_index is not null and p_current_question_index < 0 then
    raise exception 'current_question_index must be >= 0' using errcode = '22023';
  end if;

  if p_current_question_id is not null
     and p_question_ids is not null
     and not (p_current_question_id = any (p_question_ids)) then
    raise exception 'current_question_id must be included in question_ids' using errcode = '22023';
  end if;

  insert into public.selfstudy_sessions as s (
    profile_id, track_type, license_class, subject, selected_subjects,
    year, exam_round, current_question_id, current_question_index,
    question_ids, updated_at
  ) values (
    v_pid, p_track_type, p_license_class, p_subject, p_selected_subjects,
    p_year, p_exam_round, p_current_question_id, p_current_question_index,
    p_question_ids, now()
  )
  on conflict (profile_id) do update set
    track_type             = excluded.track_type,
    license_class          = excluded.license_class,
    subject                = excluded.subject,
    selected_subjects      = excluded.selected_subjects,
    year                   = excluded.year,
    exam_round             = excluded.exam_round,
    current_question_id    = excluded.current_question_id,
    current_question_index = excluded.current_question_index,
    question_ids           = excluded.question_ids,
    updated_at             = now();

  return true;
end;
$$;

-- 5-4) 최근 세션 삭제 (오답 기록은 건드리지 않음)
create function public.selfstudy_clear_session(
  p_profile_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pid bigint;
  v_n   integer;
begin
  select p.id into v_pid
  from public.selfstudy_profiles p
  where p.profile_key = p_profile_key;

  if v_pid is null then
    raise exception 'invalid profile_key' using errcode = '28000';
  end if;

  delete from public.selfstudy_sessions s
  where s.profile_id = v_pid;

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- 5-5) 오답 기록: 첫 오답 insert, 이후 wrong_count +1 / active 복귀
create function public.selfstudy_record_wrong(
  p_profile_key uuid,
  p_question_id integer
)
returns table (
  question_id    integer,
  wrong_count    integer,
  status         text,
  first_wrong_at timestamptz,
  last_wrong_at  timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_pid bigint;
  v_row public.selfstudy_wrong_questions%rowtype;
begin
  select p.id into v_pid
  from public.selfstudy_profiles p
  where p.profile_key = p_profile_key;

  if v_pid is null then
    raise exception 'invalid profile_key' using errcode = '28000';
  end if;

  -- public.questions 는 존재 검증 SELECT 로만 사용
  if p_question_id is null
     or not exists (select 1 from public.questions q where q.id = p_question_id) then
    raise exception 'question not found' using errcode = '22023';
  end if;

  insert into public.selfstudy_wrong_questions as w (profile_id, question_id)
  values (v_pid, p_question_id)
  on conflict (profile_id, question_id) do update set
    wrong_count   = w.wrong_count + 1,
    status        = 'active',
    last_wrong_at = now(),
    cleared_at    = null,
    updated_at    = now()
  returning w.* into v_row;

  return query
    select v_row.question_id, v_row.wrong_count, v_row.status,
           v_row.first_wrong_at, v_row.last_wrong_at;
end;
$$;

-- 5-6) 오답 격파: active 행만 cleared 로 전환 (행 삭제 금지)
create function public.selfstudy_clear_wrong(
  p_profile_key uuid,
  p_question_id integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pid bigint;
  v_n   integer;
begin
  select p.id into v_pid
  from public.selfstudy_profiles p
  where p.profile_key = p_profile_key;

  if v_pid is null then
    raise exception 'invalid profile_key' using errcode = '28000';
  end if;

  update public.selfstudy_wrong_questions w
  set status     = 'cleared',
      cleared_at = now(),
      updated_at = now()
  where w.profile_id  = v_pid
    and w.question_id = p_question_id
    and w.status      = 'active';

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- 5-7) active 오답 목록 (문제 본문은 프런트가 questions 에서 id 로 조회)
create function public.selfstudy_get_active_wrongs(
  p_profile_key uuid
)
returns table (
  question_id    integer,
  wrong_count    integer,
  first_wrong_at timestamptz,
  last_wrong_at  timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_pid bigint;
begin
  select p.id into v_pid
  from public.selfstudy_profiles p
  where p.profile_key = p_profile_key;

  if v_pid is null then
    raise exception 'invalid profile_key' using errcode = '28000';
  end if;

  return query
    select w.question_id, w.wrong_count, w.first_wrong_at, w.last_wrong_at
    from public.selfstudy_wrong_questions w
    where w.profile_id = v_pid
      and w.status = 'active'
    order by w.first_wrong_at asc, w.id asc;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. 함수 실행 권한: PUBLIC/anon/authenticated 일괄 회수 후 필요한 롤에만 부여
--    (signature 는 위 CREATE FUNCTION 과 정확히 일치해야 한다)
-- ---------------------------------------------------------------------
revoke all on function public.selfstudy_get_or_create_profile(text, text) from public, anon, authenticated;
revoke all on function public.selfstudy_get_session(uuid) from public, anon, authenticated;
revoke all on function public.selfstudy_save_session(uuid, text, text, text, text[], integer, text, integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public.selfstudy_clear_session(uuid) from public, anon, authenticated;
revoke all on function public.selfstudy_record_wrong(uuid, integer) from public, anon, authenticated;
revoke all on function public.selfstudy_clear_wrong(uuid, integer) from public, anon, authenticated;
revoke all on function public.selfstudy_get_active_wrongs(uuid) from public, anon, authenticated;

grant execute on function public.selfstudy_get_or_create_profile(text, text) to anon, authenticated;
grant execute on function public.selfstudy_get_session(uuid) to anon, authenticated;
grant execute on function public.selfstudy_save_session(uuid, text, text, text, text[], integer, text, integer, integer, integer[]) to anon, authenticated;
grant execute on function public.selfstudy_clear_session(uuid) to anon, authenticated;
grant execute on function public.selfstudy_record_wrong(uuid, integer) to anon, authenticated;
grant execute on function public.selfstudy_clear_wrong(uuid, integer) to anon, authenticated;
grant execute on function public.selfstudy_get_active_wrongs(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. 사후 검증 (읽기 전용). 하나라도 어긋나면 예외 → 전체 롤백.
-- ---------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'selfstudy\_%' and c.relkind = 'r';
  if v_n <> 3 then
    raise exception 'postcheck: selfstudy 테이블이 3개가 아닙니다 (%).', v_n;
  end if;

  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'selfstudy\_%' and c.relkind = 'r'
    and not c.relrowsecurity;
  if v_n <> 0 then
    raise exception 'postcheck: RLS 가 꺼진 selfstudy 테이블이 있습니다.';
  end if;

  if has_table_privilege('anon', 'public.selfstudy_profiles', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.selfstudy_profiles', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.selfstudy_wrong_questions', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.selfstudy_wrong_questions', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.selfstudy_sessions', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.selfstudy_sessions', 'select,insert,update,delete') then
    raise exception 'postcheck: anon/authenticated 에 selfstudy 테이블 직접 권한이 남아 있습니다.';
  end if;

  select count(*) into v_n
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname like 'selfstudy\_%';
  if v_n <> 7 then
    raise exception 'postcheck: selfstudy 함수가 7개가 아닙니다 (%).', v_n;
  end if;

  select count(*) into v_n
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname like 'selfstudy\_%'
    and (not p.prosecdef
         or not exists (
              select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
              where cfg like 'search_path=%public%pg_temp%'));
  if v_n <> 0 then
    raise exception 'postcheck: SECURITY DEFINER 또는 search_path 고정이 빠진 함수가 있습니다.';
  end if;

  -- PUBLIC(grantee = 0) 에 EXECUTE 가 남아 있으면 안 된다
  select count(*) into v_n
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.pronamespace = 'public'::regnamespace and p.proname like 'selfstudy\_%'
    and a.grantee = 0 and a.privilege_type = 'EXECUTE';
  if v_n <> 0 then
    raise exception 'postcheck: PUBLIC 에 EXECUTE 가 남아 있는 selfstudy 함수가 있습니다.';
  end if;

  select count(*) into v_n
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname like 'selfstudy\_%'
    and not has_function_privilege('anon', p.oid, 'execute');
  if v_n <> 0 then
    raise exception 'postcheck: anon 이 실행하지 못하는 selfstudy 함수가 있습니다.';
  end if;

  -- 이름 정규화 패턴 자체 테스트 (상수 문자열만 사용, 어떤 테이블에도 쓰지 않음):
  -- 일반 공백 / 2칸 공백 / 탭 / 개행 / NBSP(U+00A0) / 전각공백(U+3000) 이 모두 같은 값이 되어야 한다.
  select count(distinct regexp_replace(t.v, U&'[[:space:]\00A0\3000]+', '', 'g')) into v_n
  from unnest(array[
    '홍길동',
    '홍 길동',
    '홍  길동',
    '홍' || E'\t' || '길동',
    '홍' || E'\n' || '길동',
    '홍' || chr(160)   || '길동',
    '홍' || chr(12288) || '길동'
  ]) as t(v);
  if v_n <> 1 then
    raise exception 'postcheck: 이름 정규화가 공백 변형을 같은 값으로 만들지 못합니다 (distinct=%).', v_n;
  end if;

  if regexp_replace('홍' || chr(160) || '길' || chr(12288) || E'\t' || '동', U&'[[:space:]\00A0\3000]+', '', 'g') <> '홍길동' then
    raise exception 'postcheck: 이름 정규화 결과가 기대값(홍길동)과 다릅니다.';
  end if;

  -- 앞뒤 공백 제거 패턴 테스트 (앞: 전각공백+NBSP+탭+공백, 뒤: 공백+개행+NBSP)
  if regexp_replace(chr(12288) || chr(160) || E'\t ' || '301105' || E' \n' || chr(160),
                    U&'^[[:space:]\00A0\3000]+|[[:space:]\00A0\3000]+$', '', 'g') <> '301105' then
    raise exception 'postcheck: 앞뒤 공백 제거 패턴이 기대와 다릅니다.';
  end if;
end
$$;

commit;
