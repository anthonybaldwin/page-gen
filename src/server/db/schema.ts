import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chats = sqliteTable("chats", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id),
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  agentName: text("agent_name"),
  metadata: text("metadata"), // JSON string
  createdAt: integer("created_at").notNull(),
});

export const agentExecutions = sqliteTable("agent_executions", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id),
  agentName: text("agent_name").notNull(),
  status: text("status").notNull(), // 'pending' | 'running' | 'completed' | 'failed' | 'retrying'
  input: text("input").notNull(), // JSON string
  output: text("output"), // JSON string
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
});

export const tokenUsage = sqliteTable("token_usage", {
  id: text("id").primaryKey(),
  executionId: text("execution_id")
    .notNull()
    .references(() => agentExecutions.id),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id),
  agentName: text("agent_name").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  apiKeyHash: text("api_key_hash").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  totalTokens: integer("total_tokens").notNull(),
  cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
  cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
  costEstimate: real("cost_estimate").notNull(),
  estimated: integer("estimated").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

// Permanent billing ledger — NO foreign keys so records survive chat/project deletion
export const billingLedger = sqliteTable("billing_ledger", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  projectName: text("project_name"),
  chatId: text("chat_id"),
  chatTitle: text("chat_title"),
  executionId: text("execution_id"),
  agentName: text("agent_name").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  apiKeyHash: text("api_key_hash").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  totalTokens: integer("total_tokens").notNull(),
  cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
  cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
  costEstimate: real("cost_estimate").notNull(),
  estimated: integer("estimated").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const pipelineRuns = sqliteTable("pipeline_runs", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id),
  intent: text("intent").notNull(), // 'build' | 'fix' | 'question'
  scope: text("scope").notNull(), // 'frontend' | 'backend' | 'styling' | 'full'
  userMessage: text("user_message").notNull(),
  plannedAgents: text("planned_agents").notNull(), // JSON array of agent names
  status: text("status").notNull(), // 'running' | 'completed' | 'failed' | 'interrupted'
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
});

// snapshots table removed — versioning is now git-based (see services/versioning.ts)
