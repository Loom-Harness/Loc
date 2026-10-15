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
          <Title order={4}>{t("page.Home.heading.vweyym", "Customers")}</Title>
          <Anchor component={RouterLink} to="/customers">{t("page.Home.anchor.ovrhvu", "Open customers →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.dpi1wd", "Accounts")}</Title>
          <Anchor component={RouterLink} to="/accounts">{t("page.Home.anchor.8x8xhh", "Open accounts →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.oowe33", "Transfers")}</Title>
          <Anchor component={RouterLink} to="/transfers">{t("page.Home.anchor.mhb9x7", "Open transfers →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.ue0tbz", "Interest Runs")}</Title>
          <Anchor component={RouterLink} to="/interest_runs">{t("page.Home.anchor.0khfmb", "Open interest runs →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.qrue75", "Workflows")}</Title>
          <Anchor component={RouterLink} to="/workflows">{t("page.Home.anchor.l9bem9", "Open workflows →")}</Anchor>
        </Card>
      </Stack>
    </Stack>
  );
}
