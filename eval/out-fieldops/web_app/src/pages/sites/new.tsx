// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { useAllCustomers } from "../../api/customer";
import { CreateSiteRequest, useCreateSite } from "../../api/site";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function SiteNew() {
  const navigate = useNavigate();
  const create = useCreateSite();
  const __customers = useAllCustomers();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreateSiteRequest>({
    resolver: zodResolver(CreateSiteRequest),
    defaultValues: { customerId: "", label: "", addressLine: "", city: "" },
  });
  return (
    <Stack gap="md" data-testid="sites-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/sites">{t("page.New.anchor.iwtnzb", "Sites")}</Anchor>
        <Text>{t("page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.New.heading.eclojw", "Create site")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Site created" });
                    navigate(`/sites/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="sites-new">
          <Stack gap="md">
            <Controller
              control={control}
              name="customerId"
              render={({ field, fieldState }) => (
                <Select label="Customer Id" data-testid="sites-new-input-customerId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__customers.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`sites-new-input-customerId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <TextInput label="Label" {...register("label")} data-testid="sites-new-input-label" error={errors.label?.message} />
    
            <TextInput label="Address Line" {...register("addressLine")} data-testid="sites-new-input-addressLine" error={errors.addressLine?.message} />
    
            <TextInput label="City" {...register("city")} data-testid="sites-new-input-city" error={errors.city?.message} />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="sites-new-submit">Create</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
