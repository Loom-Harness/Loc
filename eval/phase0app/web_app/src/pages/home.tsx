// Auto-generated.  Do not edit by hand.
import { Link as RouterLink } from "react-router";
import { t } from "../i18n";
import { Anchor, Card, Stack, Text, Title } from "@mantine/core";

export default function Home() {
  return (
    <Stack gap="md" data-testid="home">
      <Title order={2}>{t("page.Home.heading.okelqr", "Welcome")}</Title>
      <Text>{t("page.Home.text.je8653", "Pick a section from the sidebar to start, or jump straight in below.")}</Text>
      <Stack gap="md">
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.s0roif", "Projects")}</Title>
          <Anchor component={RouterLink} to="/projects">{t("page.Home.anchor.8gl3nn", "Open projects →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.fzjmnh", "Tasks")}</Title>
          <Anchor component={RouterLink} to="/tasks">{t("page.Home.anchor.a4jz4p", "Open tasks →")}</Anchor>
        </Card>
      </Stack>
    </Stack>
  );
}
