// Auto-generated.  Do not edit by hand.
import { Link as RouterLink } from "react-router";
import { t } from "../i18n";
import { Anchor, Card, Stack, Text, Title } from "@mantine/core";

export default function Home() {
  return (
    <Stack gap="md" data-testid="home">
      <Title order={2}>{t("WebApp.page.Home.heading.okelqr", "Welcome")}</Title>
      <Text>{t("WebApp.page.Home.text.je8653", "Pick a section from the sidebar to start, or jump straight in below.")}</Text>
      <Stack gap="md">
        <Card withBorder padding="md">
          <Title order={4}>{t("Products.Product.name.other", "Products")}</Title>
          <Anchor component={RouterLink} to="/products">{t("WebApp.page.Home.anchor.zzscfl", "Open products →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("Orders.Order.name.other", "Orders")}</Title>
          <Anchor component={RouterLink} to="/orders">{t("WebApp.page.Home.anchor.9q5sic", "Open orders →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("Customers.Customer.name.other", "Customers")}</Title>
          <Anchor component={RouterLink} to="/customers">{t("WebApp.page.Home.anchor.ovrhvu", "Open customers →")}</Anchor>
        </Card>
        <Card withBorder padding="md">
          <Title order={4}>{t("WebApp.page.Home.heading.qrue75", "Workflows")}</Title>
          <Anchor component={RouterLink} to="/workflows">{t("WebApp.page.Home.anchor.l9bem9", "Open workflows →")}</Anchor>
        </Card>
      </Stack>
    </Stack>
  );
}
