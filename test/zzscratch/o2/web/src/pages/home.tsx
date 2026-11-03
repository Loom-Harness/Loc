// Auto-generated.  Do not edit by hand.
import { t } from "../i18n";
import { Button, Stack, Text, Title } from "@mantine/core";

export default function Home() {
  return (
    <Stack gap="md">
      <Title order={2}>{t("Projects.Task.name.other", "Tasks")}</Title>
      <Text>{t("Projects.Task.field.title", "Title")}</Text>
      <Text>{t("Projects.Task.op.complete", "Complete")}</Text>
      <Button>{t("Projects.Status.value.Draft", "Draft")}</Button>
      <Text>{t("Projects.Task.name.one", "Task")}</Text>
    </Stack>
  );
}
