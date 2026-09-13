// Auto-generated.  Do not edit by hand.
// Domain-owned repository ports (hexagonal architecture — audit S7).
import type * as Ids from "./ids";
import type { User } from "../auth/user-types";
import type { Asset } from "./asset";
import type { Customer } from "./customer";
import type { Invoice } from "./invoice";
import type { Organization } from "./organization";
import type { Part } from "./part";
import type { Site } from "./site";
import type { Technician } from "./technician";
import type { WorkOrder } from "./workOrder";

export interface OrganizationRepositoryPort {
  findById(id: Ids.OrganizationId): Promise<Organization | null>;
  getById(id: Ids.OrganizationId): Promise<Organization>;
  findManyByIds(ids: Ids.OrganizationId[]): Promise<Organization[]>;
  save(aggregate: Organization, expectedVersion?: number): Promise<void>;
  delete(id: Ids.OrganizationId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Organization[]; page: number; pageSize: number; total: number; totalPages: number }>;
}

export interface CustomerRepositoryPort {
  findById(id: Ids.CustomerId): Promise<Customer | null>;
  getById(id: Ids.CustomerId): Promise<Customer>;
  findManyByIds(ids: Ids.CustomerId[]): Promise<Customer[]>;
  save(aggregate: Customer, expectedVersion?: number): Promise<void>;
  delete(id: Ids.CustomerId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Customer[]; page: number; pageSize: number; total: number; totalPages: number }>;
}

export interface SiteRepositoryPort {
  findById(id: Ids.SiteId): Promise<Site | null>;
  getById(id: Ids.SiteId): Promise<Site>;
  findManyByIds(ids: Ids.SiteId[]): Promise<Site[]>;
  save(aggregate: Site, expectedVersion?: number): Promise<void>;
  delete(id: Ids.SiteId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Site[]; page: number; pageSize: number; total: number; totalPages: number }>;
}

export interface AssetRepositoryPort {
  findById(id: Ids.AssetId): Promise<Asset | null>;
  getById(id: Ids.AssetId): Promise<Asset>;
  findManyByIds(ids: Ids.AssetId[]): Promise<Asset[]>;
  save(aggregate: Asset, expectedVersion?: number): Promise<void>;
  delete(id: Ids.AssetId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Asset[]; page: number; pageSize: number; total: number; totalPages: number }>;
}

export interface TechnicianRepositoryPort {
  findById(id: Ids.TechnicianId): Promise<Technician | null>;
  getById(id: Ids.TechnicianId): Promise<Technician>;
  findManyByIds(ids: Ids.TechnicianId[]): Promise<Technician[]>;
  save(aggregate: Technician, expectedVersion?: number): Promise<void>;
  delete(id: Ids.TechnicianId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Technician[]; page: number; pageSize: number; total: number; totalPages: number }>;
}

export interface PartRepositoryPort {
  findById(id: Ids.PartId): Promise<Part | null>;
  getById(id: Ids.PartId): Promise<Part>;
  findManyByIds(ids: Ids.PartId[]): Promise<Part[]>;
  save(aggregate: Part, expectedVersion?: number): Promise<void>;
  delete(id: Ids.PartId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Part[]; page: number; pageSize: number; total: number; totalPages: number }>;
}

export interface WorkOrderRepositoryPort {
  findById(id: Ids.WorkOrderId): Promise<WorkOrder | null>;
  getById(id: Ids.WorkOrderId): Promise<WorkOrder>;
  findManyByIds(ids: Ids.WorkOrderId[]): Promise<WorkOrder[]>;
  save(aggregate: WorkOrder, expectedVersion?: number): Promise<void>;
  delete(id: Ids.WorkOrderId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: WorkOrder[]; page: number; pageSize: number; total: number; totalPages: number }>;
  mine(currentUser: User): Promise<WorkOrder[]>;
  acrossAllTenants(): Promise<WorkOrder[]>;
}

export interface InvoiceRepositoryPort {
  findById(id: Ids.InvoiceId): Promise<Invoice | null>;
  getById(id: Ids.InvoiceId): Promise<Invoice>;
  findManyByIds(ids: Ids.InvoiceId[]): Promise<Invoice[]>;
  save(aggregate: Invoice, expectedVersion?: number): Promise<void>;
  delete(id: Ids.InvoiceId): Promise<void>;
  all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Invoice[]; page: number; pageSize: number; total: number; totalPages: number }>;
}
