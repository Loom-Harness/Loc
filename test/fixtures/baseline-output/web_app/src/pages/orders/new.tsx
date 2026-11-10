// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { CreateOrderRequest, useCreateOrder } from "../../api/order";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { fieldErrorText } from "../../lib/field-error";
import { zodResolver } from "../../lib/zod-resolver";
import { Anchor, Breadcrumbs, Button, Card, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function OrderNew() {
  const navigate = useNavigate();
  const create = useCreateOrder();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreateOrderRequest>({
    resolver: zodResolver(CreateOrderRequest),
    defaultValues: { customerId: "", status: "Draft", placedAt: "" },
  });
  return (
    <Stack gap="md" data-testid="orders-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("WebApp.page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/orders">{t("Orders.Order.name.other", "Orders")}</Anchor>
        <Text>{t("WebApp.page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("WebApp.page.New.heading.9g1249", "Create order")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: t("chrome.created.Order", "Order created") });
                    navigate(`/orders/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="orders-new">
          <Stack gap="md">
            <TextInput label={ t("Orders.Order.field.customerId", "Customer Id") } {...register("customerId")} data-testid="orders-new-input-customerId" error={fieldErrorText(errors.customerId)} />
    
            <Controller
              control={control}
              name="status"
              render={({ field, fieldState }) => (
                <Select label={ t("Orders.Order.field.status", "Status") } data-testid="orders-new-input-status" data={ (["Draft","Confirmed","Shipped","Cancelled"]).map((v) => ({ value: v, label: (((v: string | null | undefined): string => v == null ? "" : ({ "Draft": t("Orders.OrderStatus.value.Draft", "Draft"), "Confirmed": t("Orders.OrderStatus.value.Confirmed", "Confirmed"), "Shipped": t("Orders.OrderStatus.value.Shipped", "Shipped"), "Cancelled": t("Orders.OrderStatus.value.Cancelled", "Cancelled") } as Record<string, string>)[v] ?? v))(v) })) } allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v)} error={fieldState.error?.message} />
              )}
            />
    
            <TextInput label={ t("Orders.Order.field.placedAt", "Placed At") } {...register("placedAt")} data-testid="orders-new-input-placedAt" type="datetime-local" error={fieldErrorText(errors.placedAt)} />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="orders-new-submit">{t("Orders.Order.op.create", "Create")}</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
