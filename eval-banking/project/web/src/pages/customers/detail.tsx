// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { ChangeEmailCustomerRequest, useChangeEmailCustomer } from "../../api/customer";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { KeyValueRow } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Breadcrumbs, Button, Card, Group, Skeleton, Stack, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useForm } from "react-hook-form";
import { useCustomerById } from "../../api/customer";
function openChangeEmailModal(mut: ReturnType<typeof useChangeEmailCustomer>): void {
  modals.open({
    title: t("page.Detail.modalTitle.qy1px1", "Change Email"),
    children: <ChangeEmailForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function ChangeEmailForm({ mut, onClose }: { mut: ReturnType<typeof useChangeEmailCustomer>; onClose: () => void }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<ChangeEmailCustomerRequest>({
    resolver: zodResolver(ChangeEmailCustomerRequest),
    defaultValues: { newEmail: "" },
  });
  return (
    <form
      data-testid="customers-op-changeEmail-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Change Email" }) });
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
        <TextInput label="New Email" {...register("newEmail")} data-testid="customers-op-changeEmail-input-newEmail" error={errors.newEmail?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="customers-op-changeEmail-submit">Change Email</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const customerById = useCustomerById(id);
  const changeEmail = useChangeEmailCustomer(id ?? "");
  return (
    <Stack gap="md" data-testid="customers-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/customers">{t("page.Detail.anchor.vweyym", "Customers")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.hw9b7u", "Customer detail")}</Title>
      <>
        { customerById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { customerById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.lz0k2j", "Couldn't load customer")}</Alert>
        ) }
        { !customerById.isLoading && !customerById.isError && !customerById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.lf0b2h", "No customer matches that id.")}</Alert>
        ) }
        { customerById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.6yjm7s", "First Name")} data-testid="customers-detail-firstName"><Text>{customerById.data.firstName}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.6p3u1s", "Last Name")} data-testid="customers-detail-lastName"><Text>{customerById.data.lastName}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.inbfc7", "Email")} data-testid="customers-detail-email"><Text>{customerById.data.email}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="customers-detail-version"><Text>{customerById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openChangeEmailModal(changeEmail)} data-testid="customers-op-changeEmail">{t("page.Detail.button.qy1px1", "Change Email")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
