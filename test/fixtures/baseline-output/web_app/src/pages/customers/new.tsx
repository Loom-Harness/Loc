// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { CreateCustomerRequest, useCreateCustomer } from "../../api/customer";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, NumberInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function CustomerNew() {
  const navigate = useNavigate();
  const create = useCreateCustomer();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreateCustomerRequest>({
    resolver: zodResolver(CreateCustomerRequest),
    defaultValues: { username: "", email: "", age: 0 },
  });
  return (
    <Stack gap="md" data-testid="customers-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("WebApp.page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/customers">{t("Customers.Customer.name.other", "Customers")}</Anchor>
        <Text>{t("WebApp.page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("WebApp.page.New.heading.m0eqrn", "Create customer")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Customer created" });
                    navigate(`/customers/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="customers-new">
          <Stack gap="md">
            <TextInput label={ t("Customers.Customer.field.username", "Username") } {...register("username")} data-testid="customers-new-input-username" error={errors.username?.message} />
    
            <TextInput label={ t("Customers.Customer.field.email", "Email") } {...register("email")} data-testid="customers-new-input-email" error={errors.email?.message} />
    
            <Controller
              control={control}
              name="age"
              render={({ field, fieldState }) => (
                <NumberInput label={ t("Customers.Customer.field.age", "Age") } data-testid="customers-new-input-age" allowDecimal={false} value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
              )}
            />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="customers-new-submit">{t("Customers.Customer.op.create", "Create")}</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
