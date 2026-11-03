// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { CreateProductRequest, useCreateProduct } from "../../api/product";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Fieldset, Group, NumberInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function ProductNew() {
  const navigate = useNavigate();
  const create = useCreateProduct();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreateProductRequest>({
    resolver: zodResolver(CreateProductRequest),
    defaultValues: { sku: "", price: { amount: 0, currency: "" } },
  });
  return (
    <Stack gap="md" data-testid="products-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("WebApp.page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/products">{t("Products.Product.name.other", "Products")}</Anchor>
        <Text>{t("WebApp.page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("WebApp.page.New.heading.lcl3va", "Create product")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Product created" });
                    navigate(`/products/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="products-new">
          <Stack gap="md">
            <TextInput label={ t("Products.Product.field.sku", "Sku") } {...register("sku")} data-testid="products-new-input-sku" error={errors.sku?.message} />
    
            <Fieldset legend={ t("Products.Product.field.price", "Price") } variant="filled" radius="md" data-testid="products-new-input-price">
              <Stack gap="sm">
                <Controller
              control={control}
              name="price.amount"
              render={({ field, fieldState }) => (
                <NumberInput label={ t("Products.Money.field.amount", "Amount") } data-testid="products-new-input-price-amount" decimalScale={2} fixedDecimalScale value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
              )}
            />
    
    <TextInput label={ t("Products.Money.field.currency", "Currency") } {...register("price.currency")} data-testid="products-new-input-price-currency" error={errors.price?.currency?.message} />
    
              </Stack>
            </Fieldset>
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="products-new-submit">{t("Products.Product.op.create", "Create")}</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
