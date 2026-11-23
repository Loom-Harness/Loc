// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { formNumber } from "../lib/form-text";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ifMatch, seg } from "./client";


export const CreateCustomerRequest = z.object({
  username: z.string(),
  email: z.string(),
  age: formNumber("int"),
}).refine((data: any) => data.username !== data.email, { path: ["username"], message: "Username must differ from email", params: { code: "Customers.Customer.rule.usernameMustDifferFromEmail", reads: ["email","username"], pointed: true } }).refine((data: any) => [...data.username].length >= 3 && [...data.username].length <= 32, { path: ["username"], message: "Username must be three to thirty two characters", params: { code: "Customers.Customer.rule.usernameMustBeThreeToThirtyTwoCharacters", reads: ["username"], pointed: true } }).refine((data: any) => /^[^@]+@[^@]+\.[^@]+$/.test(data.email) && [...data.email].length <= 120, { path: ["email"], message: "Email must be valid", params: { code: "Customers.Customer.rule.emailMustBeValid", reads: ["email"], pointed: true } }).refine((data: any) => data.age >= 18 && data.age <= 150, { path: ["age"], message: "Customer must be an adult of realistic age", params: { code: "Customers.Customer.rule.customerMustBeAnAdultOfRealisticAge", reads: ["age"], pointed: true } });
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type CreateCustomerFormState = z.input<typeof CreateCustomerRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type CreateCustomerPayload = z.output<typeof CreateCustomerRequest>;

export const UpdateCustomerRequest = z.object({
  username: z.string(),
  email: z.string(),
  age: formNumber("int"),
}).refine((data: any) => data.username !== data.email, { path: ["username"], message: "Username must differ from email", params: { code: "Customers.Customer.rule.usernameMustDifferFromEmail", reads: ["email","username"], pointed: true } }).refine((data: any) => [...data.username].length >= 3 && [...data.username].length <= 32, { path: ["username"], message: "Username must be three to thirty two characters", params: { code: "Customers.Customer.rule.usernameMustBeThreeToThirtyTwoCharacters", reads: ["username"], pointed: true } }).refine((data: any) => /^[^@]+@[^@]+\.[^@]+$/.test(data.email) && [...data.email].length <= 120, { path: ["email"], message: "Email must be valid", params: { code: "Customers.Customer.rule.emailMustBeValid", reads: ["email"], pointed: true } }).refine((data: any) => data.age >= 18 && data.age <= 150, { path: ["age"], message: "Customer must be an adult of realistic age", params: { code: "Customers.Customer.rule.customerMustBeAnAdultOfRealisticAge", reads: ["age"], pointed: true } });
export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type UpdateCustomerFormState = z.input<typeof UpdateCustomerRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type UpdateCustomerPayload = z.output<typeof UpdateCustomerRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;

export const CustomerResponse = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  age: z.number().int(),
  rowVersion: z.number().int(),
  display: z.string(),
});
export type CustomerResponse = z.infer<typeof CustomerResponse>;
export const CustomerListResponse = z.array(CustomerResponse);
export type CustomerListResponse = z.infer<typeof CustomerListResponse>;
export const CustomerPaged = z.object({ items: z.array(CustomerResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type CustomerPaged = z.infer<typeof CustomerPaged>;

export function useAllCustomers(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["customers", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/customers${qs ? "?" + qs : ""}`);
      return CustomerPaged.parse(r);
    },
  });
}

export function useCustomersOptions() {
  return useQuery({
    queryKey: ["customers", "options"],
    queryFn: async () => {
      const rows: CustomerResponse[] = [];
      for (let page = 1; ; page++) {
        const r = CustomerPaged.parse(await api.get(`/customers?page=${page}&pageSize=500`));
        rows.push(...r.items);
        if (page >= r.totalPages) return rows;
      }
    },
  });
}

export function useCustomerById(id: string | undefined) {
  return useQuery({
    queryKey: ["customers", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/customers/${seg(id)}`);
      return CustomerResponse.parse(r);
    },
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCustomerRequest) => {
      const r = await api.post(`/customers`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/customers/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateCustomerRequest) => {
      const loaded = qc.getQueryData<CustomerResponse>(["customers", id]);
      await api.post(`/customers/${seg(id)}/update`, input, ifMatch(loaded?.rowVersion));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers", id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}
