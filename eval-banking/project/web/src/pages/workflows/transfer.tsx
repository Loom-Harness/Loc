// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import { useNavigate, Link as RouterLink } from "react-router";
import { useAllAccounts } from "../../api/account";
import { TransferRequest, type TransferFormState, useTransferWorkflow } from "../../api/workflows";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function TransferWorkflow() {
  const navigate = useNavigate();
  const run = useTransferWorkflow();
  const __accounts = useAllAccounts();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<TransferFormState, unknown, TransferRequest>({
    resolver: zodResolver(TransferRequest),
    defaultValues: { sourceAccount: "", targetAccount: "", amount: new Decimal("0"), reference: "" },
  });
  return (
    <Stack gap="md" data-testid="workflow-transfer-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.TransferWorkflow.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/workflows">{t("page.TransferWorkflow.anchor.qrue75", "Workflows")}</Anchor>
        <Text>{t("page.TransferWorkflow.text.2drbmu", "Transfer")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.TransferWorkflow.heading.2drbmu", "Transfer")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    await run.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Transfer completed" });
                    navigate("/workflows");
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="workflow-transfer">
          <Stack gap="md">
            <Controller
              control={control}
              name="sourceAccount"
              render={({ field, fieldState }) => (
                <Select label="Source Account" data-testid="workflow-transfer-input-sourceAccount" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__accounts.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`workflow-transfer-input-sourceAccount-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <Controller
              control={control}
              name="targetAccount"
              render={({ field, fieldState }) => (
                <Select label="Target Account" data-testid="workflow-transfer-input-targetAccount" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__accounts.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`workflow-transfer-input-targetAccount-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <Controller
              control={control}
              name="amount"
              render={({ field, fieldState }) => (
                <TextInput label="Amount" data-testid="workflow-transfer-input-amount" value={field.value instanceof Decimal ? field.value.toString() : String(field.value ?? "0")} onChange={(e) => { try { field.onChange(new Decimal(e.currentTarget.value || "0")); } catch { field.onChange(new Decimal("0")); } }} inputMode="decimal" error={fieldState.error?.message} />
              )}
            />
    
            <TextInput label="Reference" {...register("reference")} data-testid="workflow-transfer-input-reference" error={errors.reference?.message} />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ run.isPending } data-testid="workflow-transfer-submit">Run</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
