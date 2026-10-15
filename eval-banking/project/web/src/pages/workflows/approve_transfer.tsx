// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { useAllTransfers } from "../../api/transfer";
import { ApproveTransferRequest, useApproveTransferWorkflow } from "../../api/workflows";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, Select, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function ApproveTransferWorkflow() {
  const navigate = useNavigate();
  const run = useApproveTransferWorkflow();
  const __transfers = useAllTransfers();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<ApproveTransferRequest>({
    resolver: zodResolver(ApproveTransferRequest),
    defaultValues: { transferId: "" },
  });
  return (
    <Stack gap="md" data-testid="workflow-approve_transfer-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.ApproveTransferWorkflow.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/workflows">{t("page.ApproveTransferWorkflow.anchor.qrue75", "Workflows")}</Anchor>
        <Text>{t("page.ApproveTransferWorkflow.text.bp4t8l", "Approve Transfer")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.ApproveTransferWorkflow.heading.bp4t8l", "Approve Transfer")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    await run.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Approve Transfer completed" });
                    navigate("/workflows");
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="workflow-approve_transfer">
          <Stack gap="md">
            <Controller
              control={control}
              name="transferId"
              render={({ field, fieldState }) => (
                <Select label="Transfer Id" data-testid="workflow-approve_transfer-input-transferId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__transfers.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`workflow-approve_transfer-input-transferId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ run.isPending } data-testid="workflow-approve_transfer-submit">Run</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
