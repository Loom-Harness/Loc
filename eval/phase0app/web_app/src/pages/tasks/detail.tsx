// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { useAllProjects } from "../../api/project";
import { UpdateTaskRequest, useUpdateTask } from "../../api/task";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { IdValue, KeyValueRow } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Breadcrumbs, Button, Card, Group, Select, Skeleton, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
import { useTaskById } from "../../api/task";
function openUpdateModal(mut: ReturnType<typeof useUpdateTask>): void {
  modals.open({
    title: t("page.Detail.modalTitle.uk4kus", "Update"),
    children: <UpdateForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function UpdateForm({ mut, onClose }: { mut: ReturnType<typeof useUpdateTask>; onClose: () => void }) {
  const __projects = useAllProjects();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<UpdateTaskRequest>({
    resolver: zodResolver(UpdateTaskRequest),
    defaultValues: { title: "", done: false, project: "" },
  });
  return (
    <form
      data-testid="tasks-op-update-form"
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
        <TextInput label="Title" {...register("title")} data-testid="tasks-op-update-input-title" error={errors.title?.message} />

        <Controller
          control={control}
          name="done"
          render={({ field, fieldState }) => (
            <Switch label="Done" data-testid="tasks-op-update-input-done" checked={!!field.value} onChange={(e) => field.onChange(e.currentTarget.checked)} error={fieldState.error?.message} />
          )}
        />

        <Controller
          control={control}
          name="project"
          render={({ field, fieldState }) => (
            <Select label="Project" data-testid="tasks-op-update-input-project" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__projects.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`tasks-op-update-input-project-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
          )}
        />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="tasks-op-update-submit">Update</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskById = useTaskById(id);
  const update = useUpdateTask(id ?? "");
  return (
    <Stack gap="md" data-testid="tasks-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/tasks">{t("page.Detail.anchor.fzjmnh", "Tasks")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.c3zlhx", "Task detail")}</Title>
      <>
        { taskById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { taskById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.k8nhpy", "Couldn't load task")}</Alert>
        ) }
        { !taskById.isLoading && !taskById.isError && !taskById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.csbk4i", "No task matches that id.")}</Alert>
        ) }
        { taskById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.a7vsmh", "Title")} data-testid="tasks-detail-title"><Text>{taskById.data.title}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.3cn9g1", "Done")} data-testid="tasks-detail-done"><Text>{(taskById.data.done ? "Yes" : "No")}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.y8csbi", "Project")} data-testid="tasks-detail-project"><RouterLink to={`/projects/${ taskById.data.project }`}><IdValue id={ taskById.data.project } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="tasks-detail-version"><Text>{taskById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openUpdateModal(update)} data-testid="tasks-op-update">{t("page.Detail.button.uk4kus", "Update")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
