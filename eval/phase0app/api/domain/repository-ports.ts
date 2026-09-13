// Auto-generated.  Do not edit by hand.
// Domain-owned repository ports (hexagonal architecture — audit S7).
import type * as Ids from "./ids";
import type { Project } from "./project";
import type { Task } from "./task";

export interface ProjectRepositoryPort {
  findById(id: Ids.ProjectId): Promise<Project | null>;
  getById(id: Ids.ProjectId): Promise<Project>;
  findManyByIds(ids: Ids.ProjectId[]): Promise<Project[]>;
  save(aggregate: Project, expectedVersion?: number): Promise<void>;
  delete(id: Ids.ProjectId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Project[]; page: number; pageSize: number; total: number; totalPages: number }>;
}

export interface TaskRepositoryPort {
  findById(id: Ids.TaskId): Promise<Task | null>;
  getById(id: Ids.TaskId): Promise<Task>;
  findManyByIds(ids: Ids.TaskId[]): Promise<Task[]>;
  save(aggregate: Task, expectedVersion?: number): Promise<void>;
  delete(id: Ids.TaskId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Task[]; page: number; pageSize: number; total: number; totalPages: number }>;
  byProject(projectId: Ids.ProjectId): Promise<Task[]>;
}
