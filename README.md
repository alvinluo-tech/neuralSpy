# 谁是卧底 Web（Next.js + Supabase）

一个支持多人实时房间的“谁是卧底”网页应用，包含：

- 多人创建/加入同一房间（Supabase Realtime 同步）
- 每局开局时仅调用一次 AI，生成 1 组词条（平民词/卧底词）
- 同一房间同一类别内词组去重，不会重复发同一组词
- 每轮可开启投票，每个玩家投票后由系统统一公布结果
- 房主可在房间内直接修改类别、并支持踢出玩家
- 系统自动判定胜负（卧底全出局则平民胜；卧底人数 >= 平民人数则卧底胜）

## 本地开发

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env.local
```

然后在 `.env.local` 中填写：

```bash
GROK_API_KEY=your_grok_api_key
GROK_API_URL=https://api.x.ai/v1/chat/completions
GROK_MODEL=grok-4-1-fast
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:3000`。

## 你需要在 Supabase 配置什么

在 Supabase 项目的 SQL Editor 执行以下 SQL（可直接复制）：

```sql
create extension if not exists "pgcrypto";

create table if not exists public.rooms (
	id uuid primary key default gen_random_uuid(),
	code text not null unique,
	host_session_id text not null,
	status text not null default 'lobby',
	category text not null default '日常',
	undercover_count int not null default 1,
	vote_enabled boolean not null default true,
	round_number int not null default 0,
	vote_round int not null default 1,
	last_eliminated_player_id uuid,
	result_summary text,
	created_at timestamptz not null default now()
);

create table if not exists public.players (
	id uuid primary key default gen_random_uuid(),
	room_id uuid not null references public.rooms(id) on delete cascade,
	session_id text not null,
	name text not null,
	seat_no int not null,
	is_undercover boolean not null default false,
	is_alive boolean not null default true,
	current_word text,
	joined_at timestamptz not null default now()
);

create table if not exists public.votes (
	id uuid primary key default gen_random_uuid(),
	room_id uuid not null references public.rooms(id) on delete cascade,
	round_number int not null,
	vote_round int not null,
	voter_player_id uuid not null references public.players(id) on delete cascade,
	target_player_id uuid not null references public.players(id) on delete cascade,
	created_at timestamptz not null default now(),
	unique (room_id, round_number, vote_round, voter_player_id)
);

create table if not exists public.room_word_history (
	id uuid primary key default gen_random_uuid(),
	room_id uuid not null references public.rooms(id) on delete cascade,
	category text not null,
	pair_key text not null,
	civilian text not null,
	undercover text not null,
	round_number int not null,
	created_at timestamptz not null default now(),
	unique (room_id, category, pair_key)
);

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.votes enable row level security;
alter table public.room_word_history enable row level security;

drop policy if exists "rooms open" on public.rooms;
create policy "rooms open"
on public.rooms
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "players open" on public.players;
create policy "players open"
on public.players
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "votes open" on public.votes;
create policy "votes open"
on public.votes
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "word history open" on public.room_word_history;
create policy "word history open"
on public.room_word_history
for all
to anon, authenticated
using (true)
with check (true);
```

然后到 Database > Replication，把 `rooms`、`players`、`votes` 三张表加入 Realtime。

## Grok API 说明

- 前端调用 `POST /api/grok/words`
- 服务端使用 `GROK_API_KEY` 调用 Grok 生成单组词条
- 返回结构：`{ pair: { civilian, undercover } }`
- 每次房主点击“开始本局”只会调用一次 AI

如果未配置密钥，会在前端提示配置环境变量。

## 部署到 Vercel

1. 推送代码到 Git 仓库（GitHub/GitLab/Bitbucket）
2. 在 Vercel 导入该仓库
3. 在 Vercel 项目设置中添加环境变量：

- `GROK_API_KEY`（必填）
- `GROK_API_URL`（可选）
- `GROK_MODEL`（可选）
- `NEXT_PUBLIC_SUPABASE_URL`（必填）
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`（必填）

4. 触发部署，完成后即可访问线上地址

## 脚本

- `npm run dev`：开发模式
- `npm run build`：生产构建
- `npm run start`：运行生产构建
- `npm run lint`：代码检查
