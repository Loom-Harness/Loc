// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { formNumber } from "../lib/form-text";
import { useMutation } from "@tanstack/react-query";
import { api } from "./client";

export const PlaceOrderRequest = z.object({
  customerId: z.string(),
  productId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  quantity: formNumber("int"),
});
export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type PlaceOrderFormState = z.input<typeof PlaceOrderRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type PlaceOrderPayload = z.output<typeof PlaceOrderRequest>;

export function usePlaceOrderWorkflow() {
  return useMutation({
    mutationFn: async (input: PlaceOrderRequest) => {
      await api.post(`/workflows/place_order`, input);
    },
  });
}
