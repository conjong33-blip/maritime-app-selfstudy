-- =====================================================================
-- 005_selfstudy_admin_management.sql
-- maritime-app-selfstudy 전용: 교사용 "사용자 관리" 최소 기능(PIN + 목록/수정/삭제)
--
-- 대상 Supabase project ref: fvpfkgzbztjpfuszybnf (maritime-lms / PDF 추출기와 공유)
--
-- !! 이 파일은 저장소에 보관만 한다. 자동 적용 금지, 이번 단계에서는 실행하지 않는다 !!
--    (supabase db push / migration up 사용 금지)
--    나중에 실제 적용할 때는 전체 DB 백업 후 Supabase 대시보드 SQL Editor 에서 직접 실행한다.
--    적용 직후에는 PIN 이 하나도 설정돼 있지 않아 관리자 기능이 전부 잠겨 있다(모든 호출이 PIN01 로
--    거부된다) - 파일 맨 끝의 "PIN 최초 설정 SQL" 을 반드시 이어서 직접 실행해야 실제로 쓸 수 있다.
--    그 템플릿에는 실제 PIN 값을 넣지 않았다 - 이 파일에도, 다른 어떤 저장소 파일에도 실제 PIN 평문을
--    남기지 않는다.
--
-- 이번 파일의 범위 (명확히 한다 - 사전등록/접근제한 시스템이 아니다)
--   * 학생의 "학번+이름 → 처음이면 profile 생성 → 자유롭게 자가학습" 정책은 전혀 바꾸지 않는다.
--     selfstudy_get_or_create_profile(001/004)에는 이 파일에서 어떤 것도 손대지 않는다.
--   * 여기서 하는 일은 딱 두 가지: (1) 교사가 PIN 으로 학생 목록을 보고, (2) 오타 난 학번/이름을
--     기존 profile.id 를 유지한 채 고치거나(기록 보존) 필요 없는 profile 을 통째로 지우는 것뿐이다.
--   * pagination/검색/정렬 UI/일괄 수정/일괄 삭제는 이번에 만들지 않는다(19번 항목, 학급 규모 전제).
--
-- 원칙 (001/004 와 동일)
--   * public.questions / selfstudy_question_topics / 기존 LMS / PDF 추출기 객체는 어떤 것도 변경하지 않는다
--   * selfstudy_profiles/selfstudy_wrong_questions/selfstudy_sessions 의 "기존 데이터"는 이 파일에서
--     INSERT/UPDATE/DELETE 하지 않는다(관리자 RPC 는 새 함수일 뿐, 이 파일 자체가 실행하는 DML 이 아니다).
--   * 전체가 하나의 트랜잭션: 하나라도 실패하면 전부 롤백
--   * "create or replace 를 쓰지 않는다" 원칙 - 여기 만드는 테이블/함수는 전부 새 객체이므로 순수 CREATE 만 쓴다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 사전 점검 (읽기 전용). 조건이 어긋나면 예외로 전체 롤백 - 조용히 덮어쓰지 않는다.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.selfstudy_profiles') is null
     or to_regclass('public.selfstudy_wrong_questions') is null
     or to_regclass('public.selfstudy_sessions') is null then
    raise exception 'preflight: 001_selfstudy_schema.sql 이 먼저 적용돼 있어야 합니다.';
  end if;

  -- 004 가 먼저 적용돼 있는지(순서상의 방어적 확인 - 이 파일이 그 함수를 바꾸지는 않는다).
  if to_regprocedure('public.selfstudy_get_or_create_profile(text, text)') is null then
    raise exception 'preflight: public.selfstudy_get_or_create_profile(text, text) 를 찾을 수 없습니다. 001/004 를 먼저 적용하세요.';
  end if;

  -- pgcrypto 가 설치 가능한지(crypt()/gen_salt() 는 이 확장에 있다 - Supabase 프로젝트는 보통 이미 제공한다).
  if not exists (select 1 from pg_available_extensions where name = 'pgcrypto') then
    raise exception 'preflight: pgcrypto 확장을 이 데이터베이스에서 사용할 수 없습니다.';
  end if;

  if to_regclass('public.selfstudy_admin_config') is not null then
    raise exception 'preflight: public.selfstudy_admin_config 가 이미 존재합니다.';
  end if;

  if to_regprocedure('public.selfstudy_admin_list_profiles(text)') is not null
     or to_regprocedure('public.selfstudy_admin_update_profile(text, bigint, text, text)') is not null
     or to_regprocedure('public.selfstudy_admin_delete_profile(text, bigint)') is not null then
    raise exception 'preflight: 관리자 RPC 가 이미 존재합니다.';
  end if;
end
$$;

-- pgcrypto: crypt()/gen_salt() 에 필요하다. 이미 활성화돼 있으면 아무 일도 하지 않는다(멱등).
-- (gen_random_uuid() 는 PostgreSQL 13+ 코어 내장이라 이 확장이 필요 없다 - 001 의 profile_key 기본값은 무관.)
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. selfstudy_admin_config : PIN 해시 singleton 1행. 실제 PIN 평문은 어디에도 저장하지 않는다.
--    id 를 1로 고정하는 표준 singleton 패턴(PK + CHECK) - 두 번째 행이 만들어질 수 없다.
-- ---------------------------------------------------------------------
create table public.selfstudy_admin_config (
  id         integer     not null default 1,
  pin_hash   text        not null,
  updated_at timestamptz not null default now(),

  constraint selfstudy_admin_config_pkey primary key (id),
  constraint selfstudy_admin_config_singleton_id check (id = 1)
);

comment on table public.selfstudy_admin_config is
  '교사 PIN 해시 1행짜리 설정 테이블. pin_hash 는 pgcrypto crypt() 로 만든 해시만 담는다 - 평문 PIN 은 어디에도
   저장하지 않는다. 학생 클라이언트(anon)는 이 테이블에 절대 직접 접근하지 못한다 - selfstudy_admin_* RPC
   안에서 SECURITY DEFINER 권한으로만 대조한다. 이 파일은 이 테이블을 빈 채로 만든다 - 실제 PIN 설정은
   파일 맨 끝의 수동 SQL 템플릿을 이 파일과 별도로, 사용자가 직접 실행해야 한다.';

alter table public.selfstudy_admin_config enable row level security;
-- question_topics(002)처럼 SELECT 정책조차 열어주지 않는다 - PIN 해시는 학생/교사 클라이언트 누구도 직접 읽지 못한다.
revoke all on table public.selfstudy_admin_config from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. 관리자 RPC 3개 (전부 SECURITY DEFINER, search_path 고정). PIN 검증은 세 함수 모두 맨 앞에서
--    각자 한 번씩 한다(파일 맨 위 설명대로, "꼭 필요하지 않다면 만들지 않는다" 원칙에 따라 별도 verify
--    RPC 나 공용 private 헬퍼를 새로 만들지 않고, 네 줄짜리 동일한 검사를 세 곳에 그대로 반복한다).
-- ---------------------------------------------------------------------

-- A) PIN 검증 + 전체 사용자 목록. 이 RPC 가 성공하는 것 자체가 PIN 확인이다.
create function public.selfstudy_admin_list_profiles(
  p_pin text
)
returns table (
  id           bigint,
  student_no   text,
  student_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.selfstudy_admin_config c
    where c.id = 1 and c.pin_hash is not null and c.pin_hash = extensions.crypt(coalesce(p_pin, ''), c.pin_hash)
  ) then
    raise exception 'invalid admin pin' using errcode = 'PIN01';
  end if;

  return query
    select p.id, p.student_no, p.student_name
    from public.selfstudy_profiles p
    order by p.student_no;
end;
$$;

-- B) 학번/이름 수정. profile.id 는 절대 새로 만들지 않는다 - 그래서 그 profile 의 오답/세션 기록이 그대로
--    유지된다(FK 는 profile_id 를 그대로 참조하고, 이 함수는 그 id 를 가진 행을 UPDATE 만 한다).
create function public.selfstudy_admin_update_profile(
  p_pin          text,
  p_profile_id   bigint,
  p_student_no   text,
  p_student_name text
)
returns table (
  id           bigint,
  student_no   text,
  student_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_no   text;
  v_name text;
  v_norm text;
  v_row  public.selfstudy_profiles%rowtype;
begin
  if not exists (
    select 1 from public.selfstudy_admin_config c
    where c.id = 1 and c.pin_hash is not null and c.pin_hash = extensions.crypt(coalesce(p_pin, ''), c.pin_hash)
  ) then
    raise exception 'invalid admin pin' using errcode = 'PIN01';
  end if;

  if p_profile_id is null then
    raise exception 'profile_id is required' using errcode = '22023';
  end if;

  -- 트림/길이 검증은 001 의 CHECK, selfstudy_get_or_create_profile 과 문자 하나까지 동일한 패턴을 쓴다.
  v_no   := regexp_replace(coalesce(p_student_no,   ''), U&'^[[:space:]\00A0\3000]+|[[:space:]\00A0\3000]+$', '', 'g');
  v_name := regexp_replace(coalesce(p_student_name, ''), U&'^[[:space:]\00A0\3000]+|[[:space:]\00A0\3000]+$', '', 'g');
  v_norm := regexp_replace(v_name, U&'[[:space:]\00A0\3000]+', '', 'g');

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

  if not exists (select 1 from public.selfstudy_profiles p where p.id = p_profile_id) then
    raise exception 'profile not found' using errcode = '22023';
  end if;

  -- 다른 학생이 이미 쓰는 student_no 로 바꾸는 것을 막는다(자기 자신은 제외). 현재 정책상 student_no
  -- 하나당 실제 학생 한 명을 유지하려는 의도이므로, normalized_name 은 보지 않고 student_no 만 본다
  -- (예: A=202020, B=202021 인데 B 를 202020 으로 고치면 이름이 뭐든 막는다). 학생용 selfstudy_get_or_
  -- create_profile 의 ST409 와 같은 취지라 같은 errcode 를 재사용한다 - 프런트는 이미 그 코드를 아는
  -- RPC_ERROR_CODE.DUPLICATE_STUDENT_IDENTITY 와 별개로 이 RPC 호출에서만 이 코드로 온 것을 구분해 처리한다.
  if exists (
    select 1 from public.selfstudy_profiles p2
    where p2.student_no = v_no and p2.id <> p_profile_id
  ) then
    raise exception 'student number already used by another profile' using errcode = 'ST409';
  end if;

  update public.selfstudy_profiles p
  set student_no = v_no, student_name = v_name, updated_at = now()
  where p.id = p_profile_id
  returning p.* into v_row;

  return query select v_row.id, v_row.student_no, v_row.student_name;
end;
$$;

-- C) 삭제. 반드시 profile_id 기준으로만 지운다(학번/이름 문자열로 광범위 DELETE 하지 않는다).
--    001 의 FK(on delete cascade)로 그 profile 의 오답/세션 행만 함께 삭제된다 - questions 등 공용
--    데이터, 다른 profile 은 이 문장이 절대 건드릴 수 없다(where 절이 정확히 이 id 하나만 가리킨다).
create function public.selfstudy_admin_delete_profile(
  p_pin        text,
  p_profile_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not exists (
    select 1 from public.selfstudy_admin_config c
    where c.id = 1 and c.pin_hash is not null and c.pin_hash = extensions.crypt(coalesce(p_pin, ''), c.pin_hash)
  ) then
    raise exception 'invalid admin pin' using errcode = 'PIN01';
  end if;

  if p_profile_id is null then
    raise exception 'profile_id is required' using errcode = '22023';
  end if;

  delete from public.selfstudy_profiles p where p.id = p_profile_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. 함수 실행 권한. anon/authenticated 에 EXECUTE 를 준다 - 이 앱은 Supabase Auth 를 쓰지 않으므로
--    프런트가 이 RPC 들을 부를 수 있는 유일한 롤이 anon 이다(기존 selfstudy_* RPC 7개와 동일한 전제).
--    즉 "누가 호출할 수 있는가"의 방어선은 GRANT 가 아니라 RPC 내부의 PIN 검증이다(22번 항목 - 완료
--    보고에서 이 한계를 명시한다). PUBLIC 에는 EXECUTE 를 남기지 않는다.
-- ---------------------------------------------------------------------
revoke all on function public.selfstudy_admin_list_profiles(text) from public, anon, authenticated;
revoke all on function public.selfstudy_admin_update_profile(text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.selfstudy_admin_delete_profile(text, bigint) from public, anon, authenticated;

grant execute on function public.selfstudy_admin_list_profiles(text) to anon, authenticated;
grant execute on function public.selfstudy_admin_update_profile(text, bigint, text, text) to anon, authenticated;
grant execute on function public.selfstudy_admin_delete_profile(text, bigint) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. 사후 검증 (읽기 전용 + PIN 실패 케이스 함수 호출 3건). 하나라도 어긋나면 예외 → 전체 롤백.
--    이 시점의 selfstudy_admin_config 는 비어 있으므로(아직 PIN 을 설정하지 않았다) 세 함수 전부
--    반드시 PIN01 로 거부돼야 정상이다 - 이 호출들이 실제 데이터에 어떤 흔적도 남기지 않는다.
-- ---------------------------------------------------------------------
do $$
declare
  v_n integer;
  v_caught boolean;
  v_sqlstate text;
begin
  -- 4-1) 테이블 RLS/권한
  if to_regclass('public.selfstudy_admin_config') is null then
    raise exception 'postcheck: selfstudy_admin_config 테이블이 생성되지 않았습니다.';
  end if;

  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'selfstudy_admin_config' and c.relkind = 'r'
    and not c.relrowsecurity;
  if v_n <> 0 then
    raise exception 'postcheck: selfstudy_admin_config 의 RLS 가 꺼져 있습니다.';
  end if;

  if has_table_privilege('anon', 'public.selfstudy_admin_config', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.selfstudy_admin_config', 'select,insert,update,delete') then
    raise exception 'postcheck: anon/authenticated 에 selfstudy_admin_config 직접 권한이 남아 있습니다.';
  end if;

  -- 지금은 반드시 빈 테이블이어야 한다(이 파일이 행을 넣지 않았다 - PIN 은 별도 수동 SQL 로 설정한다).
  select count(*) into v_n from public.selfstudy_admin_config;
  if v_n <> 0 then
    raise exception 'postcheck: selfstudy_admin_config 에 예상치 못한 행이 있습니다 (%).', v_n;
  end if;

  -- 4-2) 함수 시그니처/SECURITY DEFINER/search_path/권한
  if to_regprocedure('public.selfstudy_admin_list_profiles(text)') is null
     or to_regprocedure('public.selfstudy_admin_update_profile(text, bigint, text, text)') is null
     or to_regprocedure('public.selfstudy_admin_delete_profile(text, bigint)') is null then
    raise exception 'postcheck: 관리자 RPC 3개가 모두 만들어지지 않았습니다.';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      'public.selfstudy_admin_list_profiles(text)'::regprocedure,
      'public.selfstudy_admin_update_profile(text, bigint, text, text)'::regprocedure,
      'public.selfstudy_admin_delete_profile(text, bigint)'::regprocedure
    )
    and (not p.prosecdef
         or not exists (
              select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
              where cfg like 'search_path=%public%pg_temp%'
            ))
  ) then
    raise exception 'postcheck: 관리자 RPC 중 SECURITY DEFINER/search_path 고정이 빠진 함수가 있습니다.';
  end if;

  if not has_function_privilege('anon', 'public.selfstudy_admin_list_profiles(text)', 'execute')
     or not has_function_privilege('anon', 'public.selfstudy_admin_update_profile(text, bigint, text, text)', 'execute')
     or not has_function_privilege('anon', 'public.selfstudy_admin_delete_profile(text, bigint)', 'execute') then
    raise exception 'postcheck: anon 이 관리자 RPC 를 실행하지 못합니다.';
  end if;

  select count(*) into v_n
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid in (
    'public.selfstudy_admin_list_profiles(text)'::regprocedure,
    'public.selfstudy_admin_update_profile(text, bigint, text, text)'::regprocedure,
    'public.selfstudy_admin_delete_profile(text, bigint)'::regprocedure
  )
  and a.grantee = 0 and a.privilege_type = 'EXECUTE';
  if v_n <> 0 then
    raise exception 'postcheck: PUBLIC 에 EXECUTE 가 남아 있는 관리자 RPC 가 있습니다.';
  end if;

  -- 4-3) 기능 테스트: PIN 이 하나도 설정되지 않은 지금, 세 RPC 모두 반드시 PIN01 로 막혀야 한다.
  v_caught := false;
  begin
    perform public.selfstudy_admin_list_profiles('000000');
  exception when others then
    v_caught := true;
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if not v_caught or v_sqlstate <> 'PIN01' then
    raise exception 'postcheck: selfstudy_admin_list_profiles 가 PIN 미설정 상태에서 PIN01 로 막히지 않았습니다 (caught=%, sqlstate=%).', v_caught, v_sqlstate;
  end if;

  v_caught := false;
  begin
    perform public.selfstudy_admin_update_profile('000000', -1, '000000', '__ghost__');
  exception when others then
    v_caught := true;
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if not v_caught or v_sqlstate <> 'PIN01' then
    raise exception 'postcheck: selfstudy_admin_update_profile 이 PIN 미설정 상태에서 PIN01 로 막히지 않았습니다 (caught=%, sqlstate=%).', v_caught, v_sqlstate;
  end if;

  v_caught := false;
  begin
    perform public.selfstudy_admin_delete_profile('000000', -1);
  exception when others then
    v_caught := true;
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if not v_caught or v_sqlstate <> 'PIN01' then
    raise exception 'postcheck: selfstudy_admin_delete_profile 이 PIN 미설정 상태에서 PIN01 로 막히지 않았습니다 (caught=%, sqlstate=%).', v_caught, v_sqlstate;
  end if;

  -- 4-4) 위 세 호출이 전부 PIN 검증 단계에서 막혔으므로, 실제 데이터에는 어떤 흔적도 남지 않아야 한다.
  select count(*) into v_n from public.selfstudy_profiles where student_no in ('000000', '-1');
  if v_n <> 0 then
    raise exception 'postcheck: postcheck 호출로 selfstudy_profiles 에 예상치 못한 행이 생겼습니다.';
  end if;
end
$$;

commit;

-- =====================================================================
-- PIN 최초 설정 SQL (이 파일과 별도로, 사용자가 Supabase SQL Editor 에서 직접 실행한다)
-- =====================================================================
-- 이 파일(005)은 selfstudy_admin_config 를 "빈 테이블"로만 만든다 - 실제 PIN 값은 어디에도 들어있지
-- 않다. 아래 템플릿의 '<여기에 실제 PIN 입력>' 자리를 교사가 정할 실제 PIN(6자리 이상 권장 - 22번 항목,
-- 너무 짧은 PIN 은 추측되기 쉽다)으로 직접 바꿔서, 이 파일 전체를 실행한 뒤 별도로 실행한다.
-- on conflict 절 덕분에 최초 설정과 이후 PIN 변경 모두 같은 템플릿으로 할 수 있다.
--
-- insert into public.selfstudy_admin_config (id, pin_hash)
-- values (1, extensions.crypt('<여기에 실제 PIN 입력>', extensions.gen_salt('bf')))
-- on conflict (id) do update set pin_hash = excluded.pin_hash, updated_at = now();
--
-- 확인(성공하면 이 SELECT 는 오류 없이 한 행을 돌려준다 - pin_hash 자체는 여기서도 출력하지 않는다):
-- select id, updated_at from public.selfstudy_admin_config;
-- =====================================================================
