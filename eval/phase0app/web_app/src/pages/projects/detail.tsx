// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { UpdateProjectRequest, useUpdateProject } from "../../api/project";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { KeyValueRow } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Breadcrumbs, Button, Card, Group, Skeleton, Stack, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useForm } from "react-hook-form";
import { useProjectById } from "../../api/project";
function openUpdateModal(mut: ReturnType<typeof useUpdateProject>): void {
  modals.open({
    title: t("page.Detail.modalTitle.uk4kus", "Update"),
    children: <UpdateForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function UpdateForm({ mut, onClose }: { mut: ReturnType<typeof useUpdateProject>; onClose: () => void }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<UpdateProjectRequest>({
    resolver: zodResolver(UpdateProjectRequest),
    defaultValues: { name: "" },
  });
  return (
    <form
      data-testid="projects-op-update-form"
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
        <TextInput label="Name" {...register("name")} data-testid="projects-op-update-input-name" error={errors.name?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="projects-op-update-submit">Update</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectById = useProjectById(id);
  const update = useUpdateProject(id ?? "");
  return (
    <Stack gap="md" data-testid="projects-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/projects">{t("page.Detail.anchor.s0roif", "Projects")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.6hcbaj", "Project detail")}</Title>
      <>
        { projectById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { projectById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.9nvmnw", "Couldn't load project")}</Alert>
        ) }
        { !projectById.isLoading && !projectById.isError && !projectById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.sa4utq", "No project matches that id.")}</Alert>
        ) }
        { projectById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.4el6o6", "Name")} data-testid="projects-detail-name"><Text>{projectById.data.name}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="projects-detail-version"><Text>{projectById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openUpdateModal(update)} data-testid="projects-op-update">{t("page.Detail.button.uk4kus", "Update")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
