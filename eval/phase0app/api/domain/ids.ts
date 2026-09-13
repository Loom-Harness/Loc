// Auto-generated.
import { uuidv7 } from "uuidv7";

export type ProjectId = string & { readonly __brand: "ProjectId" };
export const ProjectId = (value: string): ProjectId => value as ProjectId;
export const newProjectId = (): ProjectId => uuidv7() as ProjectId;

export type TaskId = string & { readonly __brand: "TaskId" };
export const TaskId = (value: string): TaskId => value as TaskId;
export const newTaskId = (): TaskId => uuidv7() as TaskId;

