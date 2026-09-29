-- =====================================================================
-- 006_fix_admin_update_profile.sql
-- maritime-app-selfstudy 전용: selfstudy_admin_update_profile 저장 실패 patch
--
-- 대상 Supabase project ref: fvpfkgzbztjpfuszybnf (maritime-lms / PDF 추출기와 공유)
--
-- !! 이 파일은 저장소에 보관만 한다. 자동 적용 금지, 이번 단계에서는 실행하지 않는다 !!
--    (supabase db push / migration up 사용 금지)
--    나중에 실제 적용할 때는 Supabase 대시보드 SQL Editor 에서 직접 실행한다.
--
-- 배경 (확정된 원인 - 완료 보고 본문 참고)
--   교사 화면에서 재현해 실제 PostgREST 오류를 확인한 결과:
--     code=22P02, message="invalid input syntax for type uuid: \"202020\""
--   원인은 selfstudy_admin_update_profile 함수 본문의 UPDATE ... RETURNING 문이었다:
--     returning p.id, p.student_no, p.student_name into v_row;
--   v_row 는 public.selfstudy_profiles%rowtype(테이블 전체 컬럼 순서: id, profile_key(uuid),
--   student_no, student_name, normalized_name, created_at, updated_at)로 선언돼 있는데, RETURNING
--   절이 3개 컬럼만 내려주면 PL/pgSQL 이 이를 rowtype 의 앞 3개 필드에 "위치 기준"으로 그대로
--   대입한다 - 즉 두 번째로 내려준 값인 p.student_no("202020")가 rowtype 의 두 번째 필드인
--   profile_key(uuid) 자리에 그대로 들어가면서 uuid 캐스팅에 실패한 것이다. student_no 값 자체와는
--   무관하게, 프로필이 존재해 이 UPDATE 문에 도달하기만 하면 항상 발생하는 구조적 버그였다.
--
--   수정은 RETURNING 절을 rowtype 전체와 정확히 맞도록 `returning p.* into v_row;` 로 바꾸는 것
--   뿐이다 - 이후 `return query select v_row.id, v_row.student_no, v_row.student_name;` 는 이름
--   기준으로 v_row 의 필드를 꺼내 쓰므로 그대로 두면 된다.
--
-- 이번 파일의 범위 (명확히 한다)
--   * selfstudy_admin_update_profile 함수 "본문만" CREATE OR REPLACE 로 교체한다.
--   * 시그니처(인자 이름/타입/개수: p_pin text, p_profile_id bigint, p_student_no text,
--     p_student_name text)는 전혀 바꾸지 않는다 - 그래야 CREATE OR REPLACE 가 새 오버로드를
--     만들지 않고 기존 함수를 "그 자리에서" 교체하고, 기존 GRANT 도 그대로 보존된다.
--   * selfstudy_admin_list_profiles / selfstudy_admin_delete_profile 은 건드리지 않는다.
--   * selfstudy_admin_config(PIN 구조) / selfstudy_get_or_create_profile(학생 로그인) /
--     Track A/B/C 관련 RPC / selfstudy_wrong_questions / selfstudy_sessions 스키마는
--     이 파일 어디서도 건드리지 않는다.
--   * frontend(src/*) 는 이 파일과 무관 - 이번 patch 는 SQL 전용이다.
--
-- 원칙 (001/004/005 와 동일)
--   * 전체가 하나의 트랜잭션: 하나라도 실패하면 전부 롤백
--   * 001 의 "create or replace 를 쓰지 않는다" 원칙은 "새로 만드는 객체"에 대한 것이다. 여기서는
--     004 와 마찬가지로 기존 함수를 의도적으로 고치는 것이므로 CREATE OR REPLACE FUNCTION 을 쓴다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 사전 점검 (읽기 전용). 지금 배포된 시그니처가 정확히 일치해야 CREATE OR REPLACE 가
--    "새 오버로드 생성"이 아니라 "그 자리 교체"가 된다 - 어긋나 있으면 조용히 넘어가지 않고 멈춘다.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.selfstudy_admin_update_profile(text, bigint, text, text)') is null then
    raise exception 'preflight: public.selfstudy_admin_update_profile(text, bigint, text, text) 시그니처를 찾을 수 없습니다. '
      '005_selfstudy_admin_management.sql 이 먼저 적용돼 있어야 하며, 시그니처가 이 patch 와 정확히 일치해야 합니다.';
  end if;

  if to_regclass('public.selfstudy_admin_config') is null then
    raise exception 'preflight: public.selfstudy_admin_config 가 없습니다. 005 가 먼저 적용돼 있어야 합니다.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. selfstudy_admin_update_profile 교체. 005 로컬 파일과 완전히 동일한(감사 완료된) 로직이다 -
--    student_no/student_name 비교·대입은 전부 text 이고, profile_key(uuid)는 어디서도 참조하지
--    않는다. PIN 검증은 extensions.crypt/extensions.gen_salt 스키마 한정을 그대로 유지한다.
-- ---------------------------------------------------------------------
create or replace function public.selfstudy_admin_update_profile(
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

  -- 다른 학생이 이미 쓰는 student_no 로 바꾸는 것을 막는다(자기 자신은 p2.id <> p_profile_id 로 제외).
  -- student_no(text) 하나만 비교한다 - profile_key(uuid)는 여기서 전혀 쓰이지 않는다.
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

-- CREATE OR REPLACE 는 기존 ACL 을 보존하지만(004 와 동일한 방어적 스타일), 의도한 최종 권한
-- 상태를 이 파일 안에서도 명시적으로 다시 선언해 둔다.
revoke all on function public.selfstudy_admin_update_profile(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.selfstudy_admin_update_profile(text, bigint, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. 사후 검증 (읽기 전용, 구조만 확인). 실제 PIN 값은 이 마이그레이션이 알 수 없으므로 - 이미 설정된
--    PIN 해시를 알아낼 방법이 없다 - 005 의 postcheck 처럼 실제 RPC 를 호출하는 기능 테스트는 여기서
--    하지 않는다. 시그니처/SECURITY DEFINER/search_path/권한만 구조적으로 확인한다. 실제 저장 성공
--    여부는 완료 보고의 수동 테스트 계획(A~E)을 교사 화면에서 직접 재현해 확인해야 한다.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.selfstudy_admin_update_profile(text, bigint, text, text)') is null then
    raise exception 'postcheck: selfstudy_admin_update_profile(text, bigint, text, text) 가 사라졌습니다.';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid = 'public.selfstudy_admin_update_profile(text, bigint, text, text)'::regprocedure
      and (not p.prosecdef
           or not exists (
                select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                where cfg like 'search_path=%public%pg_temp%'
              ))
  ) then
    raise exception 'postcheck: SECURITY DEFINER 또는 search_path 고정이 빠졌습니다.';
  end if;

  if not has_function_privilege('anon', 'public.selfstudy_admin_update_profile(text, bigint, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.selfstudy_admin_update_profile(text, bigint, text, text)', 'execute') then
    raise exception 'postcheck: anon/authenticated 가 selfstudy_admin_update_profile 을 실행하지 못합니다.';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.selfstudy_admin_update_profile(text, bigint, text, text)'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'postcheck: PUBLIC 에 EXECUTE 가 남아 있습니다.';
  end if;
end
$$;

commit;

-- =====================================================================
-- 적용 후 반드시 교사 화면에서 직접 재현할 수동 테스트 (완료 보고의 8번 항목과 동일. 실제 PIN 필요):
--   A. 이름 공백만 변경 (예: "천종 여" -> "천종여")               -> 성공해야 한다
--   B. 이름 일반 오타 수정 (예: "천종여" -> "천종영")              -> 성공해야 한다
--   C. 학번을 사용되지 않은 값으로 변경                            -> 성공해야 한다
--   D. 다른 프로필이 이미 쓰는 학번으로 변경                       -> 저장되지 않고
--      "이미 다른 학생이 사용 중인 학번입니다." 안내가 떠야 한다
--   E. 위 A~D 전후로 해당 프로필의 id/profile_key, 오답 개수, 세션이 그대로인지 확인
-- =====================================================================
