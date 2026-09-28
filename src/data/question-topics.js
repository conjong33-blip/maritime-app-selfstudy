// public.selfstudy_question_topics 조회 (READ ONLY). 학생 앱은 SELECT 정책만 가지고 있다 (INSERT/UPDATE/DELETE 는
// 이 테이블에 전혀 없다 - db/002_selfstudy_question_topics.sql 참고). questions.id 당 매핑은 0개 또는 1개뿐이다.
// UI/state 에 의존하지 않는다. 실패하면 DataError 를 던진다 - 호출하는 쪽(track-c-actions.js)이 "매핑 조회 실패"를
// "이 오답들은 학습영역 미분류"로 다루기 위해 감싸서 쓴다.
import { DataError, getSupabaseClient, unwrap } from './supabase.js';

// questions.id 목록으로 learning_topic 매핑을 조회한다. 매핑이 없는 id(신규 문제 등)는 결과에서 조용히 빠진다 -
// 호출하는 쪽이 요청한 id 목록과 비교해서 "매핑 없음"을 판단해야 한다 (id -> null 로 채워 주지 않는다).
export async function fetchLearningTopicsByQuestionIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  if (!ids.every((id) => Number.isInteger(id))) throw new DataError('문제 id 는 정수여야 합니다.');
  const unique = [...new Set(ids)];
  const query = getSupabaseClient()
    .from('selfstudy_question_topics')
    .select('question_id,learning_topic')
    .in('question_id', unique)
    .limit(unique.length + 1);
  const rows = unwrap(await query, '학습영역 매핑 조회');
  return rows.map((row) => ({ questionId: row.question_id, learningTopic: row.learning_topic }));
}
