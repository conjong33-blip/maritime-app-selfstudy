# PROJECT_HANDOFF — maritime-app-selfstudy

> 작성 시점: 리팩터링 구현 **전**. 아래는 현재까지 확정된 내용만 기록한다.
> 기준 commit: `4a8f8c53df2df10d107f32a4323c225cc16b34c9` (chore: preserve V65 baseline)

## 1. 프로젝트 목적

- 기존 V65 해기사 자가학습 웹앱(`legacy/V65_original.html`)을, 향후 수정과 기능 추가가 쉬운 구조로 리팩터링한다.
- 기존 디자인과 학생 기능은 최대한 그대로 유지한다.
- 교사용 대시보드(교사 버튼/인증/대시보드/클리닉 등)는 새 버전에서 **제거 예정**이다.
- `legacy/V65_original.html`은 읽기 전용 기준본이다. 수정하지 않는다.

## 2. 프로젝트 분리

- 기존 maritime-lms(`해기사 수업`)와는 **별도 Git 저장소**로 운영할 예정이다(remote 미연결).
- **별도 배포 URL**을 사용할 예정이다(배포 설정 미정).
- **같은 Supabase 프로젝트**를 사용한다. project ref: `fvpfkgzbztjpfuszybnf`.
- 이 저장소에서는 maritime-lms와 PDF 추출 프로젝트의 파일을 수정하지 않는다.

## 3. 기존 시스템 DB 경계

### 공통 문제은행
- `public.questions` = 공통 문제은행.
- **PDF 추출기만 `questions`에 WRITE** 한다(기존 문제는 id를 유지한 채 UPDATE, 신규 문제만 새 id).
- LMS와 selfstudy는 `questions`를 **READ**만 한다. selfstudy는 INSERT/UPDATE/DELETE 금지.

### LMS 전용 객체 (변경 금지)
`classes`, `class_teachers`, `students`, `class_sessions`, `question_sets`, `question_set_items`,
`session_question_sets`, `student_attempts`, `student_answers`, `student_ai_summaries`,
`individual_assignments`, `individual_attempts`, `individual_answers`, `review_batches`,
`student_practice_attempts`, `student_practice_answers`, 기존 LMS RPC 전체,
`individual_assignments` Realtime publication.

### PDF 추출 전용 객체 (변경 금지)
`pdf_admins`, `pdf_extracted_questions`, `is_pdf_admin()`, `replace_staging_extraction()`,
관련 Edge Functions, Storage write, `publish_dirty` / `source_verified` / `published_at` 등 staging 상태.

### 레거시
- `exam_results`는 V65 전용 레거시 테이블이다. **새 selfstudy는 읽기/쓰기 모두 사용하지 않는다.**

## 4. questions 현재 확인 상태

- 현재 **2,475문항** (anon 키로 본 행 수, 읽기 전용 감사 시점). 이전 문서의 1,700은 오래된 수치다.
- 문제는 앞으로도 계속 추가/업데이트된다.
- `questions.id` = 실제 PRIMARY KEY (프로젝트 소유자 확인 사항. `001_selfstudy_schema.sql`의 사전 점검이 적용 시점에 다시 검증한다).
- 이미지 URL은 `questions`의 필드(`image_url`, `option_*_img`)에 저장된 값을 **trim 후 그대로** 사용한다.
- 기존 이미지 bucket이 여러 개이므로 **bucket 이름을 selfstudy 코드에 하드코딩하지 않는다.**
- 익명(anon) 키로 실제 조회되는 컬럼(감사 확인): `id, license_class, subject, year, exam_round, question_no, question_text, correct_answer, concept_tag, easy_definition, explanation, english_translation, image_url, option_ga/na/sa/aa, option_ga/na/sa/aa_img, concept_tag_ko, search_vector`. `problem_type`은 없다.
- 조회 시 `select *` 대신 필요한 컬럼만 명시한다(`search_vector`가 함께 실리는 것을 피한다).

## 5. 오답소탕 정책

- **실제로 답을 선택했고 틀린 경우만** 오답으로 등록한다. **미응답은 등록하지 않는다**(시험 점수상 오답이어도).
- Track A/B에서 나중에 정답을 맞혀도 `active` 상태는 유지한다(제거하지 않는다).
- **Track C에서 정답을 맞힌 경우에만** `cleared` 처리한다. Track C에서 오답이면 `wrong_count`가 +1 되고 `active`를 유지한다.
- `cleared`는 **DB에 보존**한다(행 삭제 금지). 학생 화면에는 `active`만 표시한다.
- `cleared` 이후 A/B에서 같은 문제를 다시 틀리면 `wrong_count` +1, `status='active'`, `cleared_at=NULL`.
- 학생+문제당 행은 **1개**만 유지한다(시도마다 행을 만드는 이벤트 로그 구조 아님).

## 6. 최근 세션 정책

- 학생당 **가장 최근 세션 1개**만 유지한다(Track별 3개 아님). 새 학습을 시작하면 덮어쓴다.
- 완료하면 세션을 삭제한다. 오답 기록에는 영향이 없다.
- **마지막 위치만 복원**한다. **답안 선택 상태는 저장하지 않는다.**
- 저장 항목: `question_ids` + `current_question_id` + `current_question_index` (+ 트랙/급수/과목/연도/회차).

## 7. 학생 프로필

- 화면에서 **학번 + 이름**만 입력한다.
- **형식 제한은 두지 않는다.** 학번 체계가 학교/학년마다 달라질 수 있고 앞자리 0이 있을 수 있으며 영문/외국인 이름도 가능하므로, `student_no`와 `student_name`은 모두 `text`이고 숫자/한글 형식 검사를 하지 않는다.
- **길이 제한만** 둔다(앞뒤 공백 제거 후 기준, 글자 수):
  - `student_no`: 1~20자
  - `student_name`: 1~50자
  - 초과/빈 값은 `selfstudy_get_or_create_profile`이 명확한 exception(errcode 22023)으로 거부하고, 테이블 CHECK가 같은 기준으로 최종 방어한다.
- 이름은 모든 공백을 제거한 값(`normalized_name`)으로 비교한다. 제거 대상: 일반 space, tab, newline 등 POSIX whitespace, **NBSP(U+00A0)**, **전각 공백(U+3000)**. 따라서 "홍길동", "홍 길동", "홍  길동", "홍⇥길동", "홍↵길동", 홍+NBSP+길동, 홍+전각공백+길동은 모두 같은 사람이다.
  - 패턴은 `U&'[[:space:]\00A0\3000]+'`(SQL 표준 유니코드 이스케이프 문자열)이다. 파싱 시점에 상수가 되므로 generated stored column에 필요한 IMMUTABLE 조건을 만족한다. 서버 인코딩이 UTF8이어야 한다(Supabase 기본).
  - 같은 표현식이 `selfstudy_profiles.normalized_name` 생성식과 `selfstudy_get_or_create_profile`의 `v_norm` 계산에 **문자 그대로** 쓰인다. 한쪽을 바꾸면 반드시 다른 쪽도 바꿔야 한다.
  - 저장되는 `student_name`은 앞뒤 공백만 제거한 **처음 등록한 표기**이고, 나중에 다른 공백 표기로 들어와도 처음 표기가 반환된다.
- `profile_key`(uuid)는 앱 내부에서 이후 RPC 접근에 쓰는 값이며 학생이 입력하지 않는다.
- **현재 PIN 없음. 학번+이름은 인증이 아니라 식별이다.**
- **알려진 한계(이번 버전에서 해결하지 않음):** 같은 학번+이름을 아는 사람은 `selfstudy_get_or_create_profile`을 호출해 기존 `profile_key`를 그대로 다시 받을 수 있다. 즉 남의 학번과 이름을 알면 그 학생의 오답 기록과 최근 세션을 읽고 바꿀 수 있다. 이를 해결하기 위한 PIN이나 Supabase Auth는 이번 버전에 넣지 않는다.
- anon이 프로필을 만들 수 있는 횟수 제한(rate limit)은 없다. 길이 제한만 있다.

## 8. 새 selfstudy DB 객체 (2026-09-19 운영 DB 적용 완료)

정의 파일: `db/001_selfstudy_schema.sql`. 모두 `selfstudy_` prefix.

**적용 상태 (2026-09-19, 운영 Supabase `fvpfkgzbztjpfuszybnf`)**
- `db/001_selfstudy_schema.sql` 적용 완료. 테이블 3개 / RPC 7개 생성 확인.
- 7개 RPC 모두 SECURITY DEFINER. 새 테이블 RLS ON, anon/authenticated의 테이블 직접 접근 차단, anon/authenticated의 RPC 실행 가능 확인.
- 프로필 동일인 인식 테스트 성공(학번+이름, 공백 변형 포함).
- 오답 누적(`wrong_count`) / clear / cleared 후 재오답 시 active 복귀 테스트 성공.
- 테스트 데이터는 rollback 후 0건 확인.
- **frontend는 아직 selfstudy RPC와 연결되지 않았다.**

- 테이블 3개: `selfstudy_profiles`, `selfstudy_wrong_questions`, `selfstudy_sessions`
- RPC 7개: `selfstudy_get_or_create_profile`, `selfstudy_get_session`, `selfstudy_save_session`,
  `selfstudy_clear_session`, `selfstudy_record_wrong`, `selfstudy_clear_wrong`, `selfstudy_get_active_wrongs`
- 새 테이블은 RLS ON + anon/authenticated/PUBLIC 직접 권한 회수. 프런트는 **RPC로만** 접근한다.
- `questions`는 FK 참조와 존재 검증 SELECT로만 사용한다.
- **FK 정책(확정):**
  - `selfstudy_wrong_questions.question_id → questions(id)`: 기본 NO ACTION(삭제 제한)을 유지한다. `ON DELETE CASCADE`를 쓰지 않는다. 학생의 누적 오답 기록이 문제 삭제와 함께 조용히 사라지면 안 되기 때문이다. PDF 추출기는 기존 `questions` 행을 DELETE→INSERT하지 않고 `id`를 유지한 채 UPDATE하는 정책이라 이 FK와 충돌하지 않는다.
  - `selfstudy_sessions.current_question_id → questions(id)`: `ON DELETE SET NULL`. 최근 세션은 임시 위치 정보라 questions 삭제를 막을 필요가 없다.
- `question_ids` 배열의 원소는 FK를 걸 수 없어 DB가 검증하지 않는다. 프런트는 복원 시 사라진 id가 있어도 견뎌야 한다.
- 이번 001에 **넣지 않은 것**: PIN, Supabase Auth 기반 로그인, profile 삭제 RPC, 상세 풀이 event log, 교사 dashboard, 추가 통계 테이블(아래 "향후 확장" 참고).
- 적용 방법: 사용자가 전체 DB 백업 후 Supabase 대시보드 SQL Editor에서 직접 실행. `supabase db push`/`migration up` 사용 금지.

## 9. V65 리팩터링 원칙

- 교사 대시보드 관련 코드(버튼, 인증, 대시보드, 클리닉, `exam_results` 사용)를 제거한다.
- 오답 식별은 `question_text`가 아니라 **`questions.id`** 를 사용한다.
- localStorage 전용 오답/세션(`smart_tutor_wrong_pool_*`, `smart_tutor_resume_session_*`)을 selfstudy DB 기반으로 이전한다. 학번/이름 자동 채움용 localStorage는 편의로 유지할 수 있다.
- 정상 UX는 유지하되 **기존 버그는 보존하지 않는다.** V65 분석에서 확인한 항목 예:
  - 부팅 시 `selectLicenseClass` → `saveSessionState`가 저장된 이어하기 세션을 빈 상태로 덮어쓸 수 있음
  - 학번이 미리 채워진 경우 자가진단/이어하기 카드가 갱신되지 않음
  - Track C 마지막 문항 이후 반응 없음
  - 데모 폴백 데이터가 오답 pool과 `exam_results`에 들어갈 수 있음
  - 해설이 비면 문항과 무관한 고정 문구를 "AI 튜터"로 표시

## 10. 아직 하지 않은 것

- ~~`db/001_selfstudy_schema.sql`의 Supabase 적용~~ → **완료 (2026-09-19, 8번 참고)**
- frontend 리팩터링 (Vite + Vanilla JS + ES Modules 골격만 있고, V65 기능 로직 이전과 selfstudy RPC 연결은 미착수)
- GitHub remote 연결 / push
- 배포 설정
- PIN/auth 강화
- teacher dashboard 신규 설계 (제거 예정이므로 신규 설계 계획 없음)

## 11. 향후 확장 항목 (이번 001 schema에는 포함하지 않음)

- **PIN 또는 Supabase Auth 기반 selfstudy 로그인**: `profile_key` 재발급 한계(7번) 해소. 테이블에 컬럼/테이블을 추가하는 `002_*.sql`로 다룬다.
- **profile 삭제 RPC**: 학번+이름을 저장하므로 개인정보 삭제 요청 대응이 필요하다. 현재는 관리자가 SQL Editor에서 직접 처리해야 한다.
- **상세 풀이 event log**: 시도마다 기록하는 로그. 현재 구조는 학생+문제당 1행 요약이다.
- **추가 통계 테이블**, **교사 dashboard**.
- 프로필 생성 빈도 제한(rate limit).
