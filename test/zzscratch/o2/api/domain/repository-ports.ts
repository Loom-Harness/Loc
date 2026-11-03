// Auto-generated.  Do not edit by hand.
// Domain-owned repository ports (hexagonal architecture — audit S7).
import type * as Ids from "./ids";
import type { Task } from "./task";

export interface TaskRepositoryPort {
  findById(id: Ids.TaskId): Promise<Task | null>;
  getById(id: Ids.TaskId): Promise<Task>;
  findManyByIds(ids: Ids.TaskId[]): Promise<Task[]>;
  save(aggregate: Task, expectedVersion?: number): Promise<void>;
  delete(id: Ids.TaskId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Task[]; page: number; pageSize: number; total: number; totalPages: number }>;
}
