// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { CreateAssetRequest, useCreateAsset } from "../../api/asset";
import { useAllSites } from "../../api/site";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function AssetNew() {
  const navigate = useNavigate();
  const create = useCreateAsset();
  const __sites = useAllSites();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreateAssetRequest>({
    resolver: zodResolver(CreateAssetRequest),
    defaultValues: { siteId: "", serialNumber: "", model: "", requiredSkill: "Electrical" },
  });
  return (
    <Stack gap="md" data-testid="assets-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/assets">{t("page.New.anchor.shidso", "Assets")}</Anchor>
        <Text>{t("page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.New.heading.dr28vl", "Create asset")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Asset created" });
                    navigate(`/assets/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="assets-new">
          <Stack gap="md">
            <Controller
              control={control}
              name="siteId"
              render={({ field, fieldState }) => (
                <Select label="Site Id" data-testid="assets-new-input-siteId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__sites.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`assets-new-input-siteId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <TextInput label="Serial Number" {...register("serialNumber")} data-testid="assets-new-input-serialNumber" error={errors.serialNumber?.message} />
    
            <TextInput label="Model" {...register("model")} data-testid="assets-new-input-model" error={errors.model?.message} />
    
            <Controller
              control={control}
              name="requiredSkill"
              render={({ field, fieldState }) => (
                <Select label="Required Skill" data-testid="assets-new-input-requiredSkill" data={ ["Electrical","Plumbing","HVAC","Refrigeration"] } allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v)} error={fieldState.error?.message} />
              )}
            />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="assets-new-submit">Create</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
//# sourceMappingURL=new.tsx.map
