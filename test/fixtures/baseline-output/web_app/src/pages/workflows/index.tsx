// Auto-generated.  Do not edit by hand.
import { Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { Anchor, Breadcrumbs, Card, Stack, Text, Title } from "@mantine/core";

export default function WorkflowsIndex() {
  return (
    <Stack gap="md" data-testid="workflows-index">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("WebApp.page.WorkflowsIndex.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("WebApp.page.WorkflowsIndex.text.qrue75", "Workflows")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("WebApp.page.WorkflowsIndex.heading.qrue75", "Workflows")}</Title>
      <Text>{t("WebApp.page.WorkflowsIndex.text.5d4da0", "System-level orchestrations.  Pick one to run.")}</Text>
      <Stack gap="md">
        <Card withBorder padding="md" data-testid="workflow-card-place_order">
          <Title order={4}>{t("Orders.placeOrder.name.one", "Place Order")}</Title>
          <Anchor component={RouterLink} to="/workflows/place_order" data-testid="workflow-place_order-run">{t("WebApp.page.WorkflowsIndex.anchor.5fm2dg", "Run →")}</Anchor>
        </Card>
      </Stack>
    </Stack>
  );
}
