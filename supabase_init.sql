-- ============================================================
-- 命格体质测评 · Supabase 初始化脚本
-- 使用方法：
--   1. 登录 https://supabase.com → 打开你的项目
--   2. 左侧 SQL Editor → New query → 把本文件全部内容粘贴进去
--   3. 点击 RUN 执行，出现 "Success" 即完成
-- ============================================================

-- 1. 密码表（结构与本地版 tokens.db 一致）
create table if not exists public.tokens (
  code        text primary key,
  total       int  not null default 3,
  used        int  not null default 0,
  created_at  timestamptz not null default now(),
  note        text not null default '',
  records     jsonb not null default '[]'::jsonb
);

-- 2. 行级安全：默认全部拒绝（匿名用户不能直接读写表）
alter table public.tokens enable row level security;
drop policy if exists "deny all for anon" on public.tokens;
-- 不添加任何允许 anon 的 policy，即默认全拒绝

-- 3. RPC：验证密码（前端调用，只验证不扣次）
create or replace function public.verify(p_code text)
returns json
language plpgsql
security definer
as $$
declare
  r public.tokens%rowtype;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if v_code = '' then
    return json_build_object('ok', false, 'msg', '请输入密码');
  end if;
  select * into r from public.tokens where code = v_code;
  if not found then
    return json_build_object('ok', false, 'msg', '密码不存在，请联系商家');
  end if;
  if r.used >= r.total then
    return json_build_object('ok', false, 'msg', '该密码的3次测试机会已用完，请联系商家获取新密码');
  end if;
  return json_build_object('ok', true, 'code', v_code, 'left', r.total - r.used, 'msg', '验证成功');
end;
$$;

-- 4. RPC：完成测试，扣1次并记录结果（前端调用）
create or replace function public.save_result(p_code text, p_result json)
returns json
language plpgsql
security definer
as $$
declare
  r public.tokens%rowtype;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_records jsonb;
  v_entry jsonb;
begin
  if v_code = '' then
    return json_build_object('ok', false);
  end if;
  select * into r from public.tokens where code = v_code for update;
  if not found then
    return json_build_object('ok', false, 'msg', '密码不存在');
  end if;
  if r.used >= r.total then
    return json_build_object('ok', false, 'msg', '该密码的3次测试机会已用完');
  end if;
  v_entry := jsonb_build_object(
    'time', to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    'main',  coalesce(p_result->>'mainName', ''),
    'sub',   coalesce(p_result->>'subName', ''),
    'score', coalesce(p_result->'scores', '{}'::json)
  );
  v_records := r.records || jsonb_build_array(v_entry);
  update public.tokens
     set used = used + 1, records = v_records
   where code = v_code
  returning * into r;
  return json_build_object('ok', true, 'left', r.total - r.used);
end;
$$;

-- 5. RPC：管理接口（批量生成密码，仅 manage.py 用 service key 调用）
create or replace function public.admin_create_tokens(p_count int, p_total int, p_note text)
returns json
language plpgsql
security definer
as $$
declare
  v_codes text[] := '{}';
  v_code text;
  i int;
begin
  if p_count < 1 or p_count > 200 then
    return json_build_object('ok', false, 'msg', '数量需在1-200之间');
  end if;
  if p_total < 1 or p_total > 99 then
    return json_build_object('ok', false, 'msg', '每码次数需在1-99之间');
  end if;
  for i in 1..p_count loop
    v_code := 'MG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into public.tokens (code, total, used, note) values (v_code, p_total, 0, coalesce(p_note, ''));
      v_codes := array_append(v_codes, v_code);
    exception when unique_violation then
      null; -- 撞码罕见，跳过
    end;
  end loop;
  return json_build_object('ok', true, 'codes', to_json(v_codes));
end;
$$;

-- 6. 授予匿名用户只能调用三个 RPC 的权限
revoke all on all tables in schema public from anon;
grant execute on function public.verify(text) to anon, authenticated;
grant execute on function public.save_result(text, json) to anon, authenticated;
grant execute on function public.admin_create_tokens(int, int, text) to service_role;
-- 注意：verify/save_result 有 security definer + 内部逻辑保护，
-- anon 没有任何表级权限，无法绕过业务规则。
