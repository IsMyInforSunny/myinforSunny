import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
// Operational counters only. Never store submitted text or model output here.
export const requestBudget=sqliteTable('request_budget',{
  id:text('id').primaryKey(),actor:text('actor').notNull(),day:text('day').notNull(),
  createdAt:integer('created_at').notNull(),reserved:integer('reserved').notNull(),
  consumed:integer('consumed'),active:integer('active').notNull().default(1),
},table=>[index('request_budget_actor_time').on(table.actor,table.createdAt),index('request_budget_day').on(table.day)]);
export const providerBackoff=sqliteTable('provider_backoff',{id:text('id').primaryKey(),untilAt:integer('until_at').notNull()});
export const researchSearchBudget=sqliteTable('research_search_budget',{
  id:text('id').primaryKey(),actor:text('actor').notNull(),day:text('day').notNull(),createdAt:integer('created_at').notNull(),
},table=>[index('research_search_actor_time').on(table.actor,table.createdAt),index('research_search_day').on(table.day)]);
export const searchMonthlyBudget=sqliteTable('search_monthly_budget',{id:text('id').primaryKey(),reserved:integer('reserved').notNull()});
