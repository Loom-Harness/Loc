// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { useAllCustomers } from "../../api/customer";
import { UpdateSiteRequest, useUpdateSite } from "../../api/site";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { IdValue, KeyValueRow } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Breadcrumbs, Button, Card, Group, Select, Skeleton, Stack, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
import { useSiteById } from "../../api/site";
function openUpdateModal(mut: ReturnType<typeof useUpdateSite>): void {
  modals.open({
    title: t("page.Detail.modalTitle.uk4kus", "Update"),
    children: <UpdateForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function UpdateForm({ mut, onClose }: { mut: ReturnType<typeof useUpdateSite>; onClose: () => void }) {
  const __customers = useAllCustomers();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<UpdateSiteRequest>({
    resolver: zodResolver(UpdateSiteRequest),
    defaultValues: { customerId: "", label: "", addressLine: "" },
  });
  return (
    <form
      data-testid="sites-op-update-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Update" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <Controller
          control={control}
          name="customerId"
          render={({ field, fieldState }) => (
            <Select label="Customer Id" data-testid="sites-op-update-input-customerId" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__customers.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`sites-op-update-input-customerId-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Label" {...register("label")} data-testid="sites-op-update-input-label" error={errors.label?.message} />

        <TextInput label="Address Line" {...register("addressLine")} data-testid="sites-op-update-input-addressLine" error={errors.addressLine?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="sites-op-update-submit">Update</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function SiteDetail() {
  const { id } = useParams<{ id: string }>();
  const siteById = useSiteById(id);
  const update = useUpdateSite(id ?? "");
  return (
    <Stack gap="md" data-testid="sites-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/sites">{t("page.Detail.anchor.iwtnzb", "Sites")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.68ue2j", "Site detail")}</Title>
      <>
        { siteById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { siteById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.5tt28k", "Couldn't load site")}</Alert>
        ) }
        { !siteById.isLoading && !siteById.isError && !siteById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.7d2ko4", "No site matches that id.")}</Alert>
        ) }
        { siteById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.0ysfxy", "Customer Id")} data-testid="sites-detail-customerId"><RouterLink to={`/customers/${ siteById.data.customerId }`}><IdValue id={ siteById.data.customerId } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.827q8t", "Label")} data-testid="sites-detail-label"><Text>{siteById.data.label}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.1bfr9v", "Address Line")} data-testid="sites-detail-addressLine"><Text>{siteById.data.addressLine}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="sites-detail-version"><Text>{siteById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openUpdateModal(update)} data-testid="sites-op-update">{t("page.Detail.button.uk4kus", "Update")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
//# sourceMappingURL=detail.tsx.map
