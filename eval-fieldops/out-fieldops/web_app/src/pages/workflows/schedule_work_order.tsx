// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { useAllTechnicians } from "../../api/technician";
import { ScheduleWorkOrderRequest, useScheduleWorkOrderWorkflow } from "../../api/workflows";
import { useAllWorkOrders } from "../../api/workOrder";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function ScheduleWorkOrderWorkflow() {
  const navigate = useNavigate();
  const run = useScheduleWorkOrderWorkflow();
  const __workOrders = useAllWorkOrders();
  const __technicians = useAllTechnicians();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<ScheduleWorkOrderRequest>({
    resolver: zodResolver(ScheduleWorkOrderRequest),
    defaultValues: { workOrder: "", technician: "", at: "" },
  });
  return (
    <Stack gap="md" data-testid="workflow-schedule_work_order-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.ScheduleWorkOrderWorkflow.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/workflows">{t("page.ScheduleWorkOrderWorkflow.anchor.qrue75", "Workflows")}</Anchor>
        <Text>{t("page.ScheduleWorkOrderWorkflow.text.len7l1", "Schedule Work Order")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.ScheduleWorkOrderWorkflow.heading.len7l1", "Schedule Work Order")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    await run.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Schedule Work Order completed" });
                    navigate("/workflows");
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="workflow-schedule_work_order">
          <Stack gap="md">
            <Controller
              control={control}
              name="workOrder"
              render={({ field, fieldState }) => (
                <Select label="Work Order" data-testid="workflow-schedule_work_order-input-workOrder" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__workOrders.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`workflow-schedule_work_order-input-workOrder-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <Controller
              control={control}
              name="technician"
              render={({ field, fieldState }) => (
                <Select label="Technician" data-testid="workflow-schedule_work_order-input-technician" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__technicians.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`workflow-schedule_work_order-input-technician-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <TextInput label="At" {...register("at")} data-testid="workflow-schedule_work_order-input-at" type="datetime-local" error={errors.at?.message} />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ run.isPending } data-testid="workflow-schedule_work_order-submit">Run</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
//# sourceMappingURL=schedule_work_order.tsx.map
