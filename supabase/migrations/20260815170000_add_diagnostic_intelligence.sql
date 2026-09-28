create table if not exists diagnostic_evidence (
  id serial primary key,
  session_id integer not null,
  category text not null,
  claim text not null,
  evidence_type text not null,
  source_name text,
  source_url text,
  source_date timestamptz,
  confidence text not null default 'medium',
  value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists diagnostic_evidence_session_idx on diagnostic_evidence(session_id);

create table if not exists diagnostic_benchmarks (
  id serial primary key,
  industry text not null,
  metric text not null,
  segment text,
  value numeric(14,4) not null,
  unit text,
  source_name text,
  source_url text,
  source_date timestamptz,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists diagnostic_benchmarks_metric_idx on diagnostic_benchmarks(industry, metric);

create table if not exists diagnostic_recommendations (
  id serial primary key,
  session_id integer not null,
  title text not null,
  problem text,
  root_cause text,
  evidence jsonb,
  action text not null,
  alternative text,
  priority text not null default 'medium',
  owner text,
  budget numeric(14,2),
  timeline text,
  kpi text,
  expected_result text,
  roi_model jsonb,
  risks jsonb,
  dependencies jsonb,
  smart_score integer,
  created_at timestamptz not null default now()
);

create index if not exists diagnostic_recommendations_session_idx on diagnostic_recommendations(session_id);

create table if not exists diagnostic_initiatives (
  id serial primary key,
  session_id integer not null,
  recommendation_id integer,
  title text not null,
  level text not null,
  owner text,
  department text,
  start_date timestamptz,
  deadline timestamptz,
  budget numeric(14,2),
  baseline numeric(14,4),
  target numeric(14,4),
  current_value numeric(14,4),
  kpi text,
  status text not null default 'not_started',
  risk text,
  dependencies jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists diagnostic_initiatives_session_idx on diagnostic_initiatives(session_id);

create table if not exists diagnostic_scenarios (
  id serial primary key,
  session_id integer not null,
  name text not null,
  assumptions jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists diagnostic_reviews (
  id serial primary key,
  session_id integer not null,
  period text not null,
  score integer,
  achieved_goals integer not null default 0,
  missed_goals integer not null default 0,
  observations text,
  decisions jsonb,
  created_at timestamptz not null default now()
);
