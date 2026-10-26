// Auto-generated.
import { pgSchema, text, integer, numeric, uuid } from "drizzle-orm/pg-core";

export const productsSchema = pgSchema("products");
export const customersSchema = pgSchema("customers");


export const products = productsSchema.table("products", {
  id: uuid("id").primaryKey(),
  sku: text("sku").notNull(),
  price_amount: numeric("price_amount").notNull(),
  price_currency: text("price_currency").notNull(),
  version: integer("version").notNull(),
});

export const customers = customersSchema.table("customers", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull(),
  email: text("email").notNull(),
  age: integer("age").notNull(),
  version: integer("version").notNull(),
});
