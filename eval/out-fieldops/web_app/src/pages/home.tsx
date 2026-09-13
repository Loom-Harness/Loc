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
          <Title order={4}>{t("page.Home.heading.1jburf", "Organizations")}</Title>
          <Anchor component={RouterLink} to="/organizations">{t("page.Home.anchor.1a3x6n", "Open organizations →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.vweyym", "Customers")}</Title>
          <Anchor component={RouterLink} to="/customers">{t("page.Home.anchor.ovrhvu", "Open customers →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.iwtnzb", "Sites")}</Title>
          <Anchor component={RouterLink} to="/sites">{t("page.Home.anchor.qed1a3", "Open sites →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.shidso", "Assets")}</Title>
          <Anchor component={RouterLink} to="/assets">{t("page.Home.anchor.y3yees", "Open assets →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.26rebs", "Technicians")}</Title>
          <Anchor component={RouterLink} to="/technicians">{t("page.Home.anchor.gsi4eg", "Open technicians →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.cegybp", "Parts")}</Title>
          <Anchor component={RouterLink} to="/parts">{t("page.Home.anchor.bcqb8d", "Open parts →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.dodp9t", "Work Orders")}</Title>
          <Anchor component={RouterLink} to="/work_orders">{t("page.Home.anchor.6bp5t5", "Open work orders →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("page.Home.heading.7b7gu1", "Invoices")}</Title>
          <Anchor component={RouterLink} to="/invoices">{t("page.Home.anchor.3ipmdt", "Open invoices →")}</Anchor>
        </Card>
      </Stack>
    </Stack>
  );
}
