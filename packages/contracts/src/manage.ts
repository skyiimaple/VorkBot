import { z } from "zod";
import { TaskSchema } from "./task.js";

const IdentifierSchema = z.string().trim().min(1);
const DateTimeSchema = z.string().datetime();
const TrimmedTextSchema = z.string().trim().min(1);

export const TaskStatusLabelSchema = z.enum([
  "排队",
  "运行中",
  "等待审批",
  "已暂停",
  "结果待确认",
  "已完成",
  "失败",
  "已取消"
]);

export const TaskListItemSchema = TaskSchema.extend({
  title: TrimmedTextSchema,
  kindLabel: TrimmedTextSchema,
  statusLabel: TaskStatusLabelSchema,
  messagePreview: z.string()
});

export const ListTasksInputSchema = z.object({
  userId: IdentifierSchema,
  limit: z.number().int().positive().max(100).optional()
});

export const ListTasksResponseSchema = z.object({
  tasks: z.array(TaskListItemSchema)
});

export const SkillStatusSchema = z.enum(["draft", "published", "archived"]);
export const SkillKindSchema = z.enum(["browser", "file", "chat", "other"]);

export const SkillSchema = z.object({
  id: IdentifierSchema,
  name: TrimmedTextSchema,
  kind: SkillKindSchema,
  kindLabel: TrimmedTextSchema,
  status: SkillStatusSchema,
  statusLabel: TrimmedTextSchema,
  summary: z.string(),
  updatedAt: DateTimeSchema
});

export const ListSkillsResponseSchema = z.object({
  skills: z.array(SkillSchema),
  source: z.enum(["stub", "database"])
});

export const WorkspaceFileKindSchema = z.enum(["file", "directory"]);

export const WorkspaceFileSchema = z.object({
  id: IdentifierSchema,
  name: TrimmedTextSchema,
  path: TrimmedTextSchema,
  kind: WorkspaceFileKindSchema,
  kindLabel: TrimmedTextSchema,
  badgeLabel: TrimmedTextSchema,
  size: z.number().int().nonnegative().optional(),
  updatedAt: DateTimeSchema.optional()
});

export const ListWorkspaceFilesResponseSchema = z.object({
  files: z.array(WorkspaceFileSchema),
  source: z.enum(["stub", "workspace"])
});

export const ModelCredentialStatusSchema = z.enum(["enabled", "disabled", "unconfigured"]);
export const ModelCredentialModeSchema = z.enum(["builtin", "remote"]);

export const ModelCredentialSchema = z.object({
  id: IdentifierSchema,
  provider: TrimmedTextSchema,
  label: TrimmedTextSchema,
  status: ModelCredentialStatusSchema,
  statusLabel: TrimmedTextSchema,
  mode: ModelCredentialModeSchema,
  modeLabel: TrimmedTextSchema,
  configured: z.boolean(),
  summary: z.string(),
  baseUrl: z.string().optional(),
  model: z.string().optional()
});

export const ListModelCredentialsResponseSchema = z.object({
  credentials: z.array(ModelCredentialSchema),
  currentMode: z.object({
    id: IdentifierSchema,
    label: TrimmedTextSchema,
    description: TrimmedTextSchema
  }),
  source: z.enum(["stub", "database"])
});

export type TaskListItem = z.infer<typeof TaskListItemSchema>;
export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;
export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type ListSkillsResponse = z.infer<typeof ListSkillsResponseSchema>;
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;
export type ListWorkspaceFilesResponse = z.infer<typeof ListWorkspaceFilesResponseSchema>;
export type ModelCredential = z.infer<typeof ModelCredentialSchema>;
export type ListModelCredentialsResponse = z.infer<typeof ListModelCredentialsResponseSchema>;
