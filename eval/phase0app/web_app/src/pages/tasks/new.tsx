// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { useAllProjects } from "../../api/project";
import { CreateTaskRequest, useCreateTask } from "../../api/task";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, Select, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function TaskNew() {
  const navigate = useNavigate();
  const create = useCreateTask();
  const __projects = useAllProjects();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreateTaskRequest>({
    resolver: zodResolver(CreateTaskRequest),
    defaultValues: { title: "", done: false, project: "" },
  });
  return (
    <Stack gap="md" data-testid="tasks-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/tasks">{t("page.New.anchor.fzjmnh", "Tasks")}</Anchor>
        <Text>{t("page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.New.heading.ceknvy", "Create task")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Task created" });
                    navigate(`/tasks/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="tasks-new">
          <Stack gap="md">
            <TextInput label="Title" {...register("title")} data-testid="tasks-new-input-title" error={errors.title?.message} />
    
            <Controller
              control={control}
              name="done"
              render={({ field, fieldState }) => (
                <Switch label="Done" data-testid="tasks-new-input-done" checked={!!field.value} onChange={(e) => field.onChange(e.currentTarget.checked)} error={fieldState.error?.message} />
              )}
            />
    
            <Controller
              control={control}
              name="project"
              render={({ field, fieldState }) => (
                <Select label="Project" data-testid="tasks-new-input-project" placeholder={t("chrome.selectPlaceholder", "Select…")} searchable data={(__projects.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))} renderOption={({ option }) => <div data-testid={`tasks-new-input-project-option-${option.value}`}>{option.label}</div>} allowDeselect={false} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} error={fieldState.error?.message} />
              )}
            />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="tasks-new-submit">Create</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
