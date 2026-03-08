import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const chatSession = sqliteTable('chat_session', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  userId: text('user_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const chatMessage = sqliteTable('chat_message', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  references: text('references'),
  createdAt: integer('created_at').notNull(),
});
