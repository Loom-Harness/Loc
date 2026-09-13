// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { useAllCustomers } from "../../api/customer";
import { CreateInvoiceRequest, useCreateInvoice } from "../../api/invoice";
import { useAllWorkOrders } from "../../api/workOrder";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, NumberInput, Select, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function InvoiceNew() {
  const navigate = useNavigate();
  const create = useCreateInvoice();
  const __workOrders = useAllWorkOrders();
  const __customers = useAllCustomers();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreateInvoiceRequest>({
    resolver: zodResolver(CreateInvoiceRequest),
    defaultValues: { workOrderId: "", customerId: "", currency: "", amount: 0, issued: false },
  });
  return (
    <Stack gap="md" data-testid="invoices-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/invoices">{t("page.New.anchor.7b7gu1", "Invoices")}</Anchor>
        <Text>{t("page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.New.heading.eyc6ie", "Create invoice")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Invoice created" });
                    navigate(`/invoices/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="invoices-new">
          <Stack gap="md">
            <Controller
              control={control}
              name="workOrderId"
              render={({ field, fieldState }) => (
                <Select label="Work Order Id" data-testid="invoices-new-input-workOrderId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__workOrders.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`invoices-new-input-workOrderId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <Controller
              control={control}
              name="customerId"
              render={({ field, fieldState }) => (
                <Select label="Customer Id" data-testid="invoices-new-input-customerId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__customers.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`invoices-new-input-customerId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <TextInput label="Currency" {...register("currency")} data-testid="invoices-new-input-currency" error={errors.currency?.message} />
    
            <Controller
              control={control}
              name="amount"
              render={({ field, fieldState }) => (
                <NumberInput label="Amount" data-testid="invoices-new-input-amount" decimalScale={2} fixedDecimalScale value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
              )}
            />
    
            <Controller
              control={control}
              name="issued"
              render={({ field, fieldState }) => (
                <Switch label="Issued" data-testid="invoices-new-input-issued" checked={!!field.value} onChange={(e) => field.onChange(e.currentTarget.checked)} error={fieldState.error?.message} />
              )}
            />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="invoices-new-submit">Create</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
