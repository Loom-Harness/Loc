// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { formNumber } from "../lib/form-text";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ifMatch, seg } from "./client";

export const MoneySchema = z.object({
  amount: formNumber("decimal"),
  currency: z.string(),
}).refine((data: any) => data.amount >= 0, { path: ["amount"], message: "Amount cannot be negative", params: { code: "Products.Money.rule.amountCannotBeNegative", reads: ["amount"], pointed: true } }).refine((data: any) => /^[A-Z]{3}$/.test(data.currency), { path: ["currency"], message: "Currency must be three uppercase letters", params: { code: "Products.Money.rule.currencyMustBeThreeUppercaseLetters", reads: ["currency"], pointed: true } });

export const CreateProductRequest = z.object({
  sku: z.string(),
  price: MoneySchema,
}).refine((data: any) => [...data.sku.trim()].length > 0, { path: ["sku"], message: "Sku is required", params: { code: "Products.Product.rule.skuIsRequired", reads: ["sku"], pointed: true } }).refine((data: any) => /^[A-Z0-9][A-Z0-9-]*$/.test(data.sku) && [...data.sku].length <= 40, { path: ["sku"], message: "Sku must be up to forty uppercase letters digits or dashes", params: { code: "Products.Product.rule.skuMustBeUpToFortyUppercaseLettersDigitsOrDashes", reads: ["sku"], pointed: true } });
export type CreateProductRequest = z.infer<typeof CreateProductRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type CreateProductFormState = z.input<typeof CreateProductRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type CreateProductPayload = z.output<typeof CreateProductRequest>;

export const UpdateProductRequest = z.object({
  sku: z.string(),
  price: MoneySchema,
}).refine((data: any) => [...data.sku.trim()].length > 0, { path: ["sku"], message: "Sku is required", params: { code: "Products.Product.rule.skuIsRequired", reads: ["sku"], pointed: true } }).refine((data: any) => /^[A-Z0-9][A-Z0-9-]*$/.test(data.sku) && [...data.sku].length <= 40, { path: ["sku"], message: "Sku must be up to forty uppercase letters digits or dashes", params: { code: "Products.Product.rule.skuMustBeUpToFortyUppercaseLettersDigitsOrDashes", reads: ["sku"], pointed: true } });
export type UpdateProductRequest = z.infer<typeof UpdateProductRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type UpdateProductFormState = z.input<typeof UpdateProductRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type UpdateProductPayload = z.output<typeof UpdateProductRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;

export const ProductResponse = z.object({
  id: z.string(),
  sku: z.string(),
  price: MoneySchema,
  rowVersion: z.number().int(),
  display: z.string(),
});
export type ProductResponse = z.infer<typeof ProductResponse>;
export const ProductListResponse = z.array(ProductResponse);
export type ProductListResponse = z.infer<typeof ProductListResponse>;
export const ProductPaged = z.object({ items: z.array(ProductResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type ProductPaged = z.infer<typeof ProductPaged>;

export function useAllProducts(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["products", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/products${qs ? "?" + qs : ""}`);
      return ProductPaged.parse(r);
    },
  });
}

export function useProductsOptions() {
  return useQuery({
    queryKey: ["products", "options"],
    queryFn: async () => {
      const rows: ProductResponse[] = [];
      for (let page = 1; ; page++) {
        const r = ProductPaged.parse(await api.get(`/products?page=${page}&pageSize=500`));
        rows.push(...r.items);
        if (page >= r.totalPages) return rows;
      }
    },
  });
}

export function useProductById(id: string | undefined) {
  return useQuery({
    queryKey: ["products", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/products/${seg(id)}`);
      return ProductResponse.parse(r);
    },
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProductRequest) => {
      const r = await api.post(`/products`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/products/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useUpdateProduct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProductRequest) => {
      const loaded = qc.getQueryData<ProductResponse>(["products", id]);
      await api.post(`/products/${seg(id)}/update`, input, ifMatch(loaded?.rowVersion));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products", id] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
