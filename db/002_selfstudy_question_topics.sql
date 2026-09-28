-- =====================================================================
-- 002_selfstudy_question_topics.sql
-- maritime-app-selfstudy 전용: "내 학습 진단" learning_topic 매핑 테이블 (스키마만)
--
-- 대상 Supabase project ref: fvpfkgzbztjpfuszybnf (maritime-lms / PDF 추출기와 공유)
--
-- !! 이 파일은 저장소에 보관만 한다. 자동 적용 금지 !!
--    (supabase db push / migration up 사용 금지)
--    사용자가 전체 DB 백업 후 Supabase 대시보드 SQL Editor에서 직접 실행한다.
--
-- 원칙 (001_selfstudy_schema.sql 과 동일)
--   * 새 객체는 selfstudy_ prefix, public schema
--   * public.questions 는 READ ONLY: FK 참조 + 존재 검증으로만 사용, 절대 수정하지 않는다
--   * 기존 LMS / PDF 추출기 / exam_results 객체는 어떤 것도 변경하지 않는다
--   * create or replace 를 쓰지 않는다: 같은 이름의 객체가 이미 있으면 실패해야 한다
--   * 전체가 하나의 트랜잭션: 하나라도 실패하면 전부 롤백
--
-- 이 파일이 001 과 다른 점 (의도적)
--   * selfstudy_profiles/wrong_questions/sessions 는 학생 개인정보/이력이라 RLS를
--     "정책 0개(전면 차단) + SECURITY DEFINER RPC 로만 접근"으로 막았다.
--   * 이 테이블(selfstudy_question_topics)은 PII가 전혀 없는 순수 참고자료(문제→학습영역
--     이름표)다. 이미 앱이 public.questions 를 anon/authenticated 로 직접 SELECT 하는 것과
--     동일한 성격이므로, RPC를 거치지 않고 "SELECT 전용 정책"으로 직접 읽게 한다. RPC를 새로
--     만들지 않는 이유: 이 테이블은 profile_key 같은 신원 확인이 전혀 필요 없는 정적 조회이므로
--     RPC 레이어를 추가하는 것이 오히려 불필요한 결합만 늘린다.
--   * INSERT/UPDATE/DELETE 는 앱에서 전혀 하지 않는다(학생은 절대 쓰기 대상이 아님). 관리자/
--     초기 적재는 service_role 키로만 수행하며, service_role 은 기본적으로 RLS 를 우회하므로
--     별도 쓰기 정책이 필요 없다.
--   * updated_at 자동 갱신용 trigger 는 새로 만들지 않는다. 001 의 세 테이블도 트리거가 아니라
--     "쓰기를 수행하는 쪽이 updated_at = now() 를 직접 지정"하는 방식이었다(RPC 안의 on conflict
--     do update 문 참고). 이 테이블도 같은 관례를 따른다 — 003 데이터 import SQL 의 INSERT ...
--     ON CONFLICT DO UPDATE 문에서 updated_at = now() 를 직접 넣는다.
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

  -- 001 과 동일한 검증: questions.id 가 여전히 integer 단일 PK 인지
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

  -- 001 이 이미 적용돼 있어야 한다 (selfstudy_profiles 등 3개 테이블 존재 확인)
  if to_regclass('public.selfstudy_profiles') is null
     or to_regclass('public.selfstudy_wrong_questions') is null
     or to_regclass('public.selfstudy_sessions') is null then
    raise exception 'preflight: 001_selfstudy_schema.sql 이 먼저 적용돼 있어야 합니다.';
  end if;

  if to_regclass('public.selfstudy_question_topics') is not null then
    raise exception 'preflight: public.selfstudy_question_topics 가 이미 존재합니다.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. selfstudy_question_topics : questions.id 당 정확히 1개의 learning_topic
--    (내 학습 진단 / Track C 관련 문제 학습에서 쓰는 "학습영역" 이름표)
-- ---------------------------------------------------------------------
create table public.selfstudy_question_topics (
  -- question_id 자체가 PK: questions 한 행당 매핑은 정확히 0개 또는 1개만 존재해야 하므로
  -- 별도 surrogate id 를 두지 않는다(001 의 다른 테이블들과 달리 여기서는 의도적으로 생략).
  question_id    integer     not null
    references public.questions(id) on delete restrict,
  -- 학생 화면에 그대로 노출되는 이름 (예: "과급기 서징·운전이상"). license_class/subject 는
  -- questions 에 이미 있으므로 여기 중복 저장하지 않는다(9번 항목 참고).
  learning_topic text        not null,
  -- 현재는 ORIGINAL_OK / CORRECTED 두 값만 쓴다 (5번 항목 참고 — CHECK 로 제한하되
  -- 확장이 필요해지면 간단한 ALTER TABLE 로 값만 추가하면 된다).
  review_status  text        not null default 'ORIGINAL_OK',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint selfstudy_question_topics_pkey
    primary key (question_id),
  constraint selfstudy_question_topics_learning_topic_not_blank
    check (length(trim(learning_topic)) > 0),
  constraint selfstudy_question_topics_review_status_check
    check (review_status in ('ORIGINAL_OK', 'CORRECTED'))
);

comment on table public.selfstudy_question_topics is
  '문제(questions.id)당 학습영역(learning_topic) 매핑. 학생 앱은 READ 전용, 쓰기는 관리자(service_role)만.';
comment on column public.selfstudy_question_topics.question_id is
  'public.questions.id 참조. ON DELETE RESTRICT — questions 행이 실수로 삭제되려 하면 매핑이 남아있는 한 차단된다(매핑까지 조용히 같이 사라지는 것을 방지).';
comment on column public.selfstudy_question_topics.learning_topic is
  '급수+과목 조합 안에서의 학습영역 이름 (예: "과급기 서징·운전이상"). license_class/subject 는 questions 에서 JOIN 으로 가져온다.';
comment on column public.selfstudy_question_topics.review_status is
  '분류 검수 상태. 현재 값: ORIGINAL_OK(자동 분류 그대로) / CORRECTED(사람이 재검토해 확정).';

-- 실사용 조회 패턴(같은 topic 의 다른 문제 찾기)을 돕는 보조 index.
-- question_id 는 PK 라 이미 인덱스가 있으므로 추가하지 않는다.
-- 테이블 크기가 작아(~2500행) 없어도 무방하지만, 쓰기가 드물고 비용이 거의 없어 추가해 둔다.
create index selfstudy_question_topics_learning_topic_idx
  on public.selfstudy_question_topics (learning_topic);

-- ---------------------------------------------------------------------
-- 2. RLS: 학생 앱은 SELECT 만 허용. INSERT/UPDATE/DELETE 정책은 만들지 않는다
--    (service_role 은 기본적으로 RLS 를 우회하므로 관리자 적재는 그대로 가능하다).
-- ---------------------------------------------------------------------
alter table public.selfstudy_question_topics enable row level security;

revoke all on table public.selfstudy_question_topics from public, anon, authenticated;
grant select on table public.selfstudy_question_topics to anon, authenticated;

create policy selfstudy_question_topics_select_all
  on public.selfstudy_question_topics
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------
-- 3. 사후 검증 (읽기 전용). 하나라도 어긋나면 예외 → 전체 롤백.
-- ---------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  if to_regclass('public.selfstudy_question_topics') is null then
    raise exception 'postcheck: selfstudy_question_topics 테이블이 생성되지 않았습니다.';
  end if;

  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'selfstudy_question_topics' and c.relkind = 'r'
    and not c.relrowsecurity;
  if v_n <> 0 then
    raise exception 'postcheck: selfstudy_question_topics 의 RLS 가 꺼져 있습니다.';
  end if;

  -- anon/authenticated 는 select 만 가능해야 한다 (insert/update/delete 는 전부 불가)
  if has_table_privilege('anon', 'public.selfstudy_question_topics', 'insert,update,delete')
     or has_table_privilege('authenticated', 'public.selfstudy_question_topics', 'insert,update,delete') then
    raise exception 'postcheck: anon/authenticated 에 쓰기 권한이 남아 있습니다.';
  end if;

  if not has_table_privilege('anon', 'public.selfstudy_question_topics', 'select')
     or not has_table_privilege('authenticated', 'public.selfstudy_question_topics', 'select') then
    raise exception 'postcheck: anon/authenticated 가 SELECT 를 못 합니다.';
  end if;

  -- FK 가 questions(id) 를 정확히 가리키는지, ON DELETE RESTRICT(confdeltype='r')인지 확인
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.selfstudy_question_topics'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.questions'::regclass
      and c.confdeltype = 'r'
  ) then
    raise exception 'postcheck: questions(id) 참조 FK 가 ON DELETE RESTRICT 로 설정되지 않았습니다.';
  end if;
end
$$;

commit;

-- =====================================================================
-- 아래는 이번 단계에서 실행하지 않는, 이후 운영에 쓸 READ ONLY 점검 쿼리 예시다.
-- (view/trigger 로 만들지 않고 주석으로만 남긴다 — 필요할 때 그대로 복사해서 쓴다)
-- =====================================================================

-- [점검 A] questions 에는 있지만 아직 학습영역 매핑이 없는 "미분류 신규 문제" 찾기
--          (PDF 추출기가 재추출 중 natural key 매칭에 실패해 새 id 로 INSERT 했을 때도 여기 걸린다)
-- select q.id, q.license_class, q.subject, q.year, q.exam_round, q.question_no, q.concept_tag_ko
-- from public.questions q
-- left join public.selfstudy_question_topics t on t.question_id = q.id
-- where t.question_id is null
-- order by q.id;

-- [점검 B] 반대 방향: mapping 에는 있지만 questions 에서 사라진 id (정상 운영에서는 항상 0건이어야 한다.
--          FK 가 ON DELETE RESTRICT 라 questions 행 삭제 자체가 막히므로, 이 쿼리가 뭔가 나온다면
--          FK 가 우회된 것이므로 즉시 조사가 필요하다)
-- select t.question_id
-- from public.selfstudy_question_topics t
-- left join public.questions q on q.id = t.question_id
-- where q.id is null;

-- [점검 C] topic 별 문항 수 분포 (급수+과목+topic 조합 기준)
-- select q.license_class, q.subject, t.learning_topic, count(*) as cnt
-- from public.selfstudy_question_topics t
-- join public.questions q on q.id = t.question_id
-- group by 1, 2, 3
-- order by 1, 2, cnt desc;
