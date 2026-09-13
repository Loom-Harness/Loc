// Auto-generated.  Do not edit by hand.
// Domain-owned repository ports (hexagonal architecture — audit S7).
import type * as Ids from "./ids";
import type { NotificationLog } from "./notificationLog";

export interface NotificationLogRepositoryPort {
  findById(id: Ids.NotificationLogId): Promise<NotificationLog | null>;
  getById(id: Ids.NotificationLogId): Promise<NotificationLog>;
  findManyByIds(ids: Ids.NotificationLogId[]): Promise<NotificationLog[]>;
  save(aggregate: NotificationLog, expectedVersion?: number): Promise<void>;
  delete(id: Ids.NotificationLogId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: NotificationLog[]; page: number; pageSize: number; total: number; totalPages: number }>;
}
