// Supabase client (singleton). 환경변수(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)가 없어도
// 이 모듈을 import 하는 것만으로는 아무 오류도 나지 않는다. 데이터 함수를 실제로 호출할 때 설정 오류를 던진다.
// selfstudy 는 Supabase Auth 를 쓰지 않으므로 세션 저장(localStorage)과 자동 갱신을 끈다.
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// 데이터 계층에서 던지는 오류. Supabase/PostgREST 오류 코드는 code 로, 원본 오류는 cause 로 보존한다.
export class DataError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DataError';
    this.code = code;
  }
}

export class SupabaseConfigError extends DataError {
  constructor() {
    super('Supabase 설정이 없습니다. VITE_SUPABASE_URL 과 VITE_SUPABASE_ANON_KEY 를 설정해 주세요.');
    this.name = 'SupabaseConfigError';
  }
}

let client = null;

export function isSupabaseConfigured() {
  return Boolean(config.supabase.url && config.supabase.anonKey);
}

// client 를 처음 필요로 할 때 만든다. 설정이 없으면 SupabaseConfigError 를 던진다.
export function getSupabaseClient() {
  if (client) return client;
  if (!isSupabaseConfigured()) throw new SupabaseConfigError();
  client = createClient(config.supabase.url, config.supabase.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

// supabase-js 응답({ data, error })에서 error 를 DataError 로 바꾸고, 없으면 data 를 돌려준다.
export function unwrap({ data, error }, context) {
  if (error) {
    throw new DataError(`${context} 실패: ${error.message}`, { code: error.code ?? null, cause: error });
  }
  return data;
}
