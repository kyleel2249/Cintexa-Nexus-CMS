import type pg from "pg";

/**
 * Idempotent schema bootstrap.
 *
 * Generated from the Drizzle schema (`drizzle-kit export`) and made re-runnable
 * (CREATE TABLE IF NOT EXISTS / guarded constraints). Running it on every API boot
 * means a fresh database works immediately - no "relation ... does not exist"
 * errors in Sites, Pages, Posts, Media, Categories, Menus, Forms, SEO, Settings or
 * the Diagnostics intake share links - without needing a manual `drizzle-kit push`.
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"description" text,
	"favicon" text,
	"logo" text,
	"status" text DEFAULT 'active' NOT NULL,
	"primary_color" text,
	"language" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "page_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" text NOT NULL,
	"template" text,
	"content" text,
	"meta_title" text,
	"meta_description" text,
	"featured_image" text,
	"saved_by" text DEFAULT 'Admin' NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"template" text,
	"content" text,
	"meta_title" text,
	"meta_description" text,
	"featured_image" text,
	"published_at" timestamp,
	"scheduled_at" timestamp,
	"source_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"excerpt" text,
	"content" text,
	"author_id" integer,
	"category_id" integer,
	"featured_image" text,
	"meta_title" text,
	"meta_description" text,
	"keywords" text,
	"citation_links" text,
	"reading_time" integer,
	"published_at" timestamp,
	"scheduled_at" timestamp,
	"source_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"url" text NOT NULL,
	"alt_text" text,
	"caption" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "cms_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"avatar" text,
	"bio" text,
	"status" text DEFAULT 'active' NOT NULL,
	"password_hash" text,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_users_email_unique" UNIQUE("email")
)`,
  `CREATE TABLE IF NOT EXISTS "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "post_tags" (
	"post_id" integer NOT NULL,
	"tag_id" integer NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "menus" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"items" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "form_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_id" integer NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"fields" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "intake_public_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_link_id" integer NOT NULL,
	"token" text NOT NULL,
	"payload" text NOT NULL,
	"company_name" text,
	"status" text DEFAULT 'received' NOT NULL,
	"profile_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "intake_share_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"label" text DEFAULT 'Diagnostic Intake' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intake_share_links_token_unique" UNIQUE("token")
)`,
  `CREATE TABLE IF NOT EXISTS "redirects" (
	"id" serial PRIMARY KEY NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"type" integer DEFAULT 301 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "seo_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_title" text DEFAULT 'My Website' NOT NULL,
	"site_description" text DEFAULT '' NOT NULL,
	"robots" text DEFAULT 'index, follow' NOT NULL,
	"google_analytics_id" text,
	"google_search_console_id" text,
	"og_image" text,
	"twitter_handle" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_title" text NOT NULL,
	"user_name" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "traffic_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "traffic_stats_date_unique" UNIQUE("date")
)`,
  `CREATE TABLE IF NOT EXISTS "subscribers" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_email_unique" UNIQUE("email")
)`,
  `CREATE TABLE IF NOT EXISTS "plugins" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plugins_slug_unique" UNIQUE("slug")
)`,
  `CREATE TABLE IF NOT EXISTS "post_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"url" text NOT NULL,
	"alt_text" text,
	"prompt" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_thumbnail" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "social_broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_id" text,
	"error" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "post_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text,
	"content" text NOT NULL,
	"sentiment" text DEFAULT 'positive' NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_competitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer,
	"name" text NOT NULL,
	"website" text,
	"positioning" text,
	"strengths" text,
	"weaknesses" text,
	"pricing" text,
	"target_customers" text,
	"market_share" text,
	"scorecard" jsonb DEFAULT '{}' NOT NULL,
	"strategy_analysis" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer,
	"goal_type" text DEFAULT 'strategic' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner" text,
	"department" text,
	"deadline" text,
	"kpi" text,
	"baseline" text,
	"target" text,
	"current_value" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"parent_goal_id" integer,
	"smart_score" integer,
	"dependencies" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"website" text,
	"industry" text,
	"sub_industry" text,
	"business_model" text,
	"customer_type" text,
	"geographic_markets" text,
	"target_customers" text,
	"company_size" text,
	"employee_count" integer,
	"revenue_range" text,
	"annual_growth" text,
	"monthly_revenue" integer,
	"gross_margin" integer,
	"net_margin" integer,
	"avg_transaction_value" integer,
	"customer_lifetime_value" integer,
	"customer_acquisition_cost" integer,
	"monthly_leads" integer,
	"monthly_qualified_leads" integer,
	"monthly_customers" integer,
	"conversion_rate" integer,
	"customer_churn" integer,
	"retention_rate" integer,
	"sales_cycle_days" integer,
	"main_products" text,
	"main_services" text,
	"main_revenue_sources" text,
	"main_competitors" text,
	"technology_stack" text,
	"crm_system" text,
	"accounting_system" text,
	"marketing_platforms" text,
	"ecommerce_platform" text,
	"communication_systems" text,
	"existing_automation" text,
	"strategic_objectives" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer,
	"mode" text DEFAULT 'standard' NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"total_steps" integer DEFAULT 10 NOT NULL,
	"answers" jsonb DEFAULT '{}' NOT NULL,
	"pillar_scores" jsonb DEFAULT '{}' NOT NULL,
	"overall_score" integer,
	"ai_analysis" jsonb,
	"recommendations" jsonb,
	"smart_goals" jsonb,
	"execution_roadmap" jsonb,
	"swot_analysis" jsonb,
	"competitive_analysis" jsonb,
	"benchmark_comparison" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_benchmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"industry" text NOT NULL,
	"metric" text NOT NULL,
	"segment" text,
	"value" numeric(14, 4) NOT NULL,
	"unit" text,
	"source_name" text,
	"source_url" text,
	"source_date" timestamp,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"category" text NOT NULL,
	"claim" text NOT NULL,
	"evidence_type" text NOT NULL,
	"source_name" text,
	"source_url" text,
	"source_date" timestamp,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"value" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_initiatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"recommendation_id" integer,
	"title" text NOT NULL,
	"level" text NOT NULL,
	"owner" text,
	"department" text,
	"start_date" timestamp,
	"deadline" timestamp,
	"budget" numeric(14, 2),
	"baseline" numeric(14, 4),
	"target" numeric(14, 4),
	"current_value" numeric(14, 4),
	"kpi" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"risk" text,
	"dependencies" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"title" text NOT NULL,
	"problem" text,
	"root_cause" text,
	"evidence" jsonb,
	"action" text NOT NULL,
	"alternative" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"owner" text,
	"budget" numeric(14, 2),
	"timeline" text,
	"kpi" text,
	"expected_result" text,
	"roi_model" jsonb,
	"risks" jsonb,
	"dependencies" jsonb,
	"smart_score" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"period" text NOT NULL,
	"score" integer,
	"achieved_goals" integer DEFAULT 0 NOT NULL,
	"missed_goals" integer DEFAULT 0 NOT NULL,
	"observations" text,
	"decisions" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"name" text NOT NULL,
	"assumptions" jsonb DEFAULT '{}' NOT NULL,
	"outputs" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "diagnostic_task_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer,
	"profile_id" integer,
	"task_type" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"actor" text DEFAULT 'system',
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL
)`,
  `DO $$ BEGIN
  ALTER TABLE "diagnostic_competitors" ADD CONSTRAINT "diagnostic_competitors_profile_id_diagnostic_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "diagnostic_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$`,
  `DO $$ BEGIN
  ALTER TABLE "diagnostic_goals" ADD CONSTRAINT "diagnostic_goals_session_id_diagnostic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "diagnostic_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$`,
  `DO $$ BEGIN
  ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_profile_id_diagnostic_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "diagnostic_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$`,
  `CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_share_links_token ON intake_share_links(token)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_public_submissions_token ON intake_public_submissions(token)`,
  `CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_pages_scheduled ON pages(scheduled_at)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(scheduled_at)`
];

let running: Promise<void> | null = null;

export function ensureSchema(pool: pg.Pool): Promise<void> {
  if (!running) {
    running = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await pool.query(statement);
      }
    })().catch((err) => {
      running = null; // allow a retry on the next call
      throw err;
    });
  }
  return running;
}
