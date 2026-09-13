// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { useAllCustomers } from "../../api/customer";
import { useAllSites } from "../../api/site";
import { CreateWorkOrderRequest, useCreateWorkOrder } from "../../api/workOrder";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function WorkOrderNew() {
  const navigate = useNavigate();
  const create = useCreateWorkOrder();
  const __customers = useAllCustomers();
  const __sites = useAllSites();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreateWorkOrderRequest>({
    resolver: zodResolver(CreateWorkOrderRequest),
    defaultValues: { customerId: "", siteId: "", status: "Draft", priority: "Low", currency: "" },
  });
  return (
    <Stack gap="md" data-testid="work_orders-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/work_orders">{t("page.New.anchor.dodp9t", "Work Orders")}</Anchor>
        <Text>{t("page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.New.heading.39j5bi", "Create work order")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Work Order created" });
                    navigate(`/work_orders/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="work_orders-new">
          <Stack gap="md">
            <Controller
              control={control}
              name="customerId"
              render={({ field, fieldState }) => (
                <Select label="Customer Id" data-testid="work_orders-new-input-customerId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__customers.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`work_orders-new-input-customerId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <Controller
              control={control}
              name="siteId"
              render={({ field, fieldState }) => (
                <Select label="Site Id" data-testid="work_orders-new-input-siteId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__sites.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`work_orders-new-input-siteId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <Controller
              control={control}
              name="status"
              render={({ field, fieldState }) => (
                <Select label="Status" data-testid="work_orders-new-input-status" data={ ["Draft","Scheduled","InProgress","Completed","Cancelled"] } allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v)} error={fieldState.error?.message} />
              )}
            />
    
            <Controller
              control={control}
              name="priority"
              render={({ field, fieldState }) => (
                <Select label="Priority" data-testid="work_orders-new-input-priority" data={ ["Low","Normal","High","Urgent"] } allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v)} error={fieldState.error?.message} />
              )}
            />
    
            <TextInput label="Currency" {...register("currency")} data-testid="work_orders-new-input-currency" error={errors.currency?.message} />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="work_orders-new-submit">Create</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
