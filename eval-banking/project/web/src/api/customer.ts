// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";


export const CreateCustomerRequest = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
}).refine((data: any) => data.email.includes("@"), { path: ["email"], message: "Invariant violated: email.contains(\"@\")" });
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequest>;

export const ChangeEmailCustomerRequest = z.object({
  newEmail: z.string(),
}).refine((data: any) => data.newEmail.includes("@"), { path: ["newEmail"], message: "Invariant violated: newEmail.contains(\"@\")" });
export type ChangeEmailCustomerRequest = z.infer<typeof ChangeEmailCustomerRequest>;


export const CustomerResponse = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  version: z.number().int(),
  display: z.string(),
});
export type CustomerResponse = z.infer<typeof CustomerResponse>;
export const CustomerListResponse = z.array(CustomerResponse);
export type CustomerListResponse = z.infer<typeof CustomerListResponse>;

export function useAllCustomers() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const r = await api.get(`/customers`);
      return CustomerListResponse.parse(r);
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

export function useChangeEmailCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChangeEmailCustomerRequest) => {
      await api.post(`/customers/${seg(id)}/change_email`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers", id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}
