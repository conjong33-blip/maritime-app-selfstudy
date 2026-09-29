-- =====================================================================
-- 004_selfstudy_prevent_duplicate_identity.sql
-- maritime-app-selfstudy 전용: "같은 학번 + 다른 이름"이면 새 profile 을 만들지 않는다
--
-- 대상 Supabase project ref: fvpfkgzbztjpfuszybnf (maritime-lms / PDF 추출기와 공유)
--
-- !! 이 파일은 저장소에 보관만 한다. 자동 적용 금지, 이번 단계에서는 실행하지 않는다 !!
--    (supabase db push / migration up 사용 금지)
--    나중에 실제 적용할 때는 전체 DB 백업 후 Supabase 대시보드 SQL Editor 에서 직접 실행한다.
--
-- 이번 파일의 범위 (명확히 한다 - 사전등록 기능이 아니다)
--   * 사전등록 명단(selfstudy_students) 은 만들지 않는다. 등록 없이 학번+이름으로 자유롭게 쓰는
--     현재 정책은 그대로 유지한다.
--   * 딱 하나만 고친다: 이미 쓰이고 있는 student_no 에 다른(normalized_name 기준으로 정말 다른)
--     이름이 들어오면, 새 profile 을 만드는 대신 명확한 예외로 막는다.
--   * 테이블 schema 는 전혀 바꾸지 않는다(컬럼/제약/인덱스 추가 없음) - selfstudy_get_or_create_profile
--     함수 로직만 CREATE OR REPLACE 로 교체한다.
--   * 기존 selfstudy_profiles/selfstudy_wrong_questions/selfstudy_sessions 의 데이터는 이 파일에서
--     어떤 INSERT/UPDATE/DELETE 도 하지 않는다(진짜 운영 데이터를 건드리는 문장은 preflight 의
--     읽기 전용 SELECT 뿐이다).
--
-- 원칙 (001 과 동일)
--   * public.questions / 기존 LMS / PDF 추출기 객체는 어떤 것도 변경하지 않는다
--   * 전체가 하나의 트랜잭션: 하나라도 실패하면 전부 롤백
--   * 001 의 "create or replace 를 쓰지 않는다" 원칙은 "새로 만드는 객체"에 대한 것이다. 여기서는
--     001 에 있는 기존 함수를 의도적으로 바꾸는 것이므로 CREATE OR REPLACE FUNCTION 을 쓴다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 사전 점검 (읽기 전용). 조건이 어긋나면 예외로 전체 롤백 - 조용히 넘어가지 않는다.
-- ---------------------------------------------------------------------
do $$
declare
  v_conflict_count integer;
  v_sample text;
begin
  if to_regclass('public.selfstudy_profiles') is null then
    raise exception 'preflight: public.selfstudy_profiles 가 없습니다. 001_selfstudy_schema.sql 이 먼저 적용돼 있어야 합니다.';
  end if;

  if to_regprocedure('public.selfstudy_get_or_create_profile(text, text)') is null then
    raise exception 'preflight: public.selfstudy_get_or_create_profile(text, text) 를 찾을 수 없습니다.';
  end if;

  -- 지금 그 함수가 SECURITY DEFINER + search_path 고정 상태인지 확인 (001 postcheck 와 동일 조건).
  if exists (
    select 1
    from pg_proc p
    where p.oid = 'public.selfstudy_get_or_create_profile(text, text)'::regprocedure
      and (not p.prosecdef
           or not exists (
                select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                where cfg like 'search_path=%public%pg_temp%'
              ))
  ) then
    raise exception 'preflight: 기존 selfstudy_get_or_create_profile 이 SECURITY DEFINER/search_path 고정 상태가 아닙니다.';
  end if;

  -- ---------------------------------------------------------------------
  -- 핵심 preflight: 지금 이미 "같은 student_no 인데 서로 다른 normalized_name" 이 존재하는지 확인한다.
  -- 이런 데이터가 있으면 이 마이그레이션이 조용히 적용돼서는 안 된다 - 사용자가 먼저 직접 확인해야 한다.
  -- (이 마이그레이션 자체는 이미 존재하는 그런 profile 들의 "기존 로그인"을 막지는 않는다 - 각 profile 은
  --  자신의 정확한 이름으로는 계속 조회된다. 다만 그 student_no 로 "또 다른 세 번째 이름"이 새로 들어오는
  --  것은 이 마이그레이션 이후 막히므로, 이미 있는 충돌을 사용자가 알고 있어야 한다.)
  -- ---------------------------------------------------------------------
  select count(*) into v_conflict_count
  from (
    select student_no
    from public.selfstudy_profiles
    group by student_no
    having count(distinct normalized_name) > 1
  ) t;

  if v_conflict_count > 0 then
    raise exception 'preflight: 이미 같은 student_no 에 서로 다른 이름(normalized_name)을 가진 profile 이 % 개의 student_no 에서 발견되었습니다. '
      '정책 적용 전에 사용자가 직접 확인해야 합니다 (조회: select student_no, count(distinct normalized_name), array_agg(distinct student_name) '
      'from public.selfstudy_profiles group by student_no having count(distinct normalized_name) > 1;). 확인 후 문제가 없다면 이 preflight 를 '
      '주석 처리하거나 완화해서 다시 실행하세요.', v_conflict_count;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. selfstudy_get_or_create_profile 교체
--    시그니처/리턴 타입/기존 트림·길이 검증·동시성(unique_violation) 처리는 001 과 완전히 동일하게
--    유지한다. 딱 한 부분만 바뀐다: "같은 student_no 가 이미 있는데 그 어느 profile 의 normalized_name
--    과도 일치하지 않으면" 새 profile 을 만들지 않고 예외로 막는다.
--    앱 코드(src/profile.js 의 ensureProfile 등)는 이 함수를 지금과 같은 이름/시그니처로 계속
--    호출하므로 SQL 만으로 정책이 적용된다(단, 이 예외를 학생에게 친절한 문구로 바꿔 보여주려면
--    프론트에서 이 errcode 를 구분해서 처리해야 한다 - 별도 src 변경으로 함께 진행한다).
-- ---------------------------------------------------------------------
create or replace function public.selfstudy_get_or_create_profile(
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
    -- ---- 이번 파일에서 새로 추가하는 부분: 동일 학번의 다른 정체성 생성 차단 --------------------
    -- 정확히 일치하는 profile 은 없지만, 같은 student_no 를 쓰는 다른 profile 이 이미 있다면
    -- (즉 normalized_name 이 실제로 다르다면) 새 profile 을 만들지 않는다 - 오타/다른 사람 입력으로
    -- 학습기록이 쪼개지는 것을 막는다. 기존 이름 전체는 에러 메시지에 담지 않는다(개인정보 최소 노출).
    -- errcode 는 PostgreSQL 표준 unique_violation(23505) 을 쓰지 않는다 - 23505 는 실제 UNIQUE
    -- 제약 위반(예: 바로 아래 race-condition 처리, 또는 앞으로 생길 수 있는 다른 unique 위반)에도
    -- 그대로 쓰이는 범용 코드라서, 그런 경우까지 "같은 학번으로 등록된 사용자가 있습니다" 라는 학생
    -- 안내로 잘못 처리될 위험이 있다. 대신 이 의도적인 정책 위반만을 가리키는 전용 코드 'ST409' 를
    -- 쓴다(Student 409-Conflict 를 딴 임의 명칭 - PostgreSQL 표준 에러코드 표에 없는 값이고, 이
    -- 함수는 지금까지 22023 만 썼으므로 다른 RPC 들의 28000(invalid profile_key)과도 혼동되지 않는다).
    -- 프런트는 error.code === 'ST409' 일 때만 이 학생 안내 문구를 보여준다(src/data/selfstudy.js 의
    -- RPC_ERROR_CODE.DUPLICATE_STUDENT_IDENTITY 참고) - 실제 unique_violation(23505)/네트워크 오류/
    -- 기타 RPC 오류는 전부 기존 일반 연결 오류 흐름 그대로 처리된다.
    if exists (select 1 from public.selfstudy_profiles p2 where p2.student_no = v_no) then
      raise exception 'student number already exists with different name' using errcode = 'ST409';
    end if;
    -- --------------------------------------------------------------------------------------------
    begin
      insert into public.selfstudy_profiles (student_no, student_name)
      values (v_no, v_name)
      returning * into v_row;
      v_is_new := true;
    exception when unique_violation then
      -- 동시 생성 race: 다른 트랜잭션이 먼저 같은 (student_no, normalized_name) 을 만들었으므로 다시 조회.
      -- (위에서 이미 "다른 이름의 같은 student_no" 는 걸러졌으므로, 여기서 잡히는 unique_violation 은
      --  거의 항상 "동시에 같은 학생이 같은 이름으로 첫 로그인"하는 정상적인 race 뿐이다.)
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

-- CREATE OR REPLACE 는 기존 ACL(grant/revoke)을 그대로 보존하지만, 의도한 최종 권한 상태를
-- 이 파일 안에서도 명시적으로 다시 선언해 둔다(001 과 동일한 방어적 스타일).
revoke all on function public.selfstudy_get_or_create_profile(text, text) from public, anon, authenticated;
grant execute on function public.selfstudy_get_or_create_profile(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. 사후 검증 (읽기 전용 + 실패/성공 케이스 함수 호출). 하나라도 어긋나면 예외 → 전체 롤백.
--    아래 함수 호출들은 전부 "이번 트랜잭션 안에서만 존재할 수 없는" 가짜 student_no 를 쓰므로,
--    실제 운영 데이터에는 흔적을 남기지 않는다(마지막에 postcheck 스스로 확인한다).
-- ---------------------------------------------------------------------
do $$
declare
  v_n integer;
  v_caught boolean;
  v_sqlstate text;
  -- student_no 최대 길이(20자)를 넘지 않는 값이어야 한다(선행 시도에서 30자짜리 값을 써서
  -- get_or_create_profile 자체의 길이 검증(22023)에 걸려 postcheck 가 실패했었다).
  v_probe_no constant text := '__004_probe__'; -- 13자
begin
  -- 2-1) 함수 시그니처/SECURITY DEFINER/search_path/권한이 여전히 올바른지
  if to_regprocedure('public.selfstudy_get_or_create_profile(text, text)') is null then
    raise exception 'postcheck: selfstudy_get_or_create_profile(text, text) 가 사라졌습니다.';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid = 'public.selfstudy_get_or_create_profile(text, text)'::regprocedure
      and (not p.prosecdef
           or not exists (
                select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                where cfg like 'search_path=%public%pg_temp%'
              ))
  ) then
    raise exception 'postcheck: selfstudy_get_or_create_profile 이 SECURITY DEFINER/search_path 고정 상태가 아닙니다.';
  end if;

  if not has_function_privilege('anon', 'public.selfstudy_get_or_create_profile(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.selfstudy_get_or_create_profile(text, text)', 'execute') then
    raise exception 'postcheck: anon/authenticated 가 selfstudy_get_or_create_profile 을 실행하지 못합니다.';
  end if;

  select count(*) into v_n
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = 'public.selfstudy_get_or_create_profile(text, text)'::regprocedure
    and a.grantee = 0 and a.privilege_type = 'EXECUTE';
  if v_n <> 0 then
    raise exception 'postcheck: PUBLIC 에 EXECUTE 가 남아 있습니다.';
  end if;

  -- 2-2) 기능 테스트 A: 처음 보는 student_no 는 여전히 정상적으로 새 profile 을 만든다(기존 정책 보존).
  perform public.selfstudy_get_or_create_profile(v_probe_no, '홍길동');
  if not exists (
    select 1 from public.selfstudy_profiles p where p.student_no = v_probe_no and p.student_name = '홍길동'
  ) then
    raise exception 'postcheck: 신규 student_no 로 profile 이 생성되지 않았습니다.';
  end if;

  -- 2-3) 기능 테스트 B: 같은 student_no + 이름 띄어쓰기 차이는 여전히 "같은 profile"로 취급된다
  --      (새 행이 추가로 생기지 않는다 - normalized_name 매칭이 그대로 동작함을 확인).
  perform public.selfstudy_get_or_create_profile(v_probe_no, '홍  길동');
  select count(*) into v_n from public.selfstudy_profiles p where p.student_no = v_probe_no;
  if v_n <> 1 then
    raise exception 'postcheck: 띄어쓰기 차이만 있는 이름이 같은 profile 로 처리되지 않았습니다 (행 개수 %).', v_n;
  end if;

  -- 2-4) 기능 테스트 C: 같은 student_no + 실제로 다른 이름은 반드시 전용 코드 ST409 로 막혀야 하고
  --      (실제 unique_violation 인 23505 가 아니어야 한다 - 일반 unique 위반과 섞이면 안 된다),
  --      그 시도로 새 행이 추가로 생기면 안 된다.
  v_caught := false;
  begin
    perform public.selfstudy_get_or_create_profile(v_probe_no, '김철수');
  exception when others then
    v_caught := true;
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;

  if not v_caught then
    raise exception 'postcheck: 같은 student_no + 다른 이름 호출이 막히지 않고 성공했습니다.';
  end if;
  if v_sqlstate <> 'ST409' then
    raise exception 'postcheck: 같은 student_no + 다른 이름 호출의 errcode 가 ST409 가 아닙니다 (%).', v_sqlstate;
  end if;

  select count(*) into v_n from public.selfstudy_profiles p where p.student_no = v_probe_no;
  if v_n <> 1 then
    raise exception 'postcheck: 다른 이름 시도 이후 student_no=% 의 profile 행 개수가 1 이 아닙니다 (%).', v_probe_no, v_n;
  end if;

  -- 2-5) postcheck 이 만든 테스트 데이터를 스스로 정리한다(운영 데이터에 흔적을 남기지 않는다).
  --      wrong_questions/sessions 는 이 profile 을 대상으로 한 적이 없으므로 정리할 것이 없다
  --      (혹시 몰라 cascade 로도 안전하다 - 001 의 on delete cascade).
  delete from public.selfstudy_profiles where student_no = v_probe_no;
  if exists (select 1 from public.selfstudy_profiles where student_no = v_probe_no) then
    raise exception 'postcheck: 테스트 profile 정리에 실패했습니다.';
  end if;
end
$$;

commit;

-- =====================================================================
-- 참고: 이 마이그레이션은 selfstudy_profiles 를 UPDATE/DELETE 하지 않는다(postcheck 의 자체 테스트
-- 데이터 정리 DELETE 는 예외 - 그 DELETE 는 이 파일이 방금 만든 가짜 student_no 행 하나만 지운다).
-- 기존에 이미 저장돼 있던 실제 학생 profile/오답/세션은 이 파일 어디서도 건드리지 않는다.
-- =====================================================================
