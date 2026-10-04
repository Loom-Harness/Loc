// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { useAllCustomers } from "../../api/customer";
import { OpenAccountRequest, useOpenAccountWorkflow } from "../../api/workflows";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function OpenAccountWorkflow() {
  const navigate = useNavigate();
  const run = useOpenAccountWorkflow();
  const __customers = useAllCustomers();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<OpenAccountRequest>({
    resolver: zodResolver(OpenAccountRequest),
    defaultValues: { owner: "", number: "", accountType: "Checking", currency: "" },
  });
  return (
    <Stack gap="md" data-testid="workflow-open_account-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.OpenAccountWorkflow.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/workflows">{t("page.OpenAccountWorkflow.anchor.qrue75", "Workflows")}</Anchor>
        <Text>{t("page.OpenAccountWorkflow.text.39wewu", "Open Account")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.OpenAccountWorkflow.heading.39wewu", "Open Account")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    await run.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Open Account completed" });
                    navigate("/workflows");
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="workflow-open_account">
          <Stack gap="md">
            <Controller
              control={control}
              name="owner"
              render={({ field, fieldState }) => (
                <Select label="Owner" data-testid="workflow-open_account-input-owner" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__customers.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`workflow-open_account-input-owner-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <TextInput label="Number" {...register("number")} data-testid="workflow-open_account-input-number" error={errors.number?.message} />
    
            <Controller
              control={control}
              name="accountType"
              render={({ field, fieldState }) => (
                <Select label="Account Type" data-testid="workflow-open_account-input-accountType" data={ ["Checking","Savings"] } allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v)} error={fieldState.error?.message} />
              )}
            />
    
            <TextInput label="Currency" {...register("currency")} data-testid="workflow-open_account-input-currency" error={errors.currency?.message} />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ run.isPending } data-testid="workflow-open_account-submit">Run</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
