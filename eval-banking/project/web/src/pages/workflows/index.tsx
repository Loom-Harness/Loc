// Auto-generated.  Do not edit by hand.
import { Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { Anchor, Breadcrumbs, Card, Stack, Text, Title } from "@mantine/core";

export default function WorkflowsIndex() {
  return (
    <Stack gap="md" data-testid="workflows-index">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.WorkflowsIndex.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.WorkflowsIndex.text.qrue75", "Workflows")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.WorkflowsIndex.heading.qrue75", "Workflows")}</Title>
      <Text>{t("page.WorkflowsIndex.text.5d4da0", "System-level orchestrations.  Pick one to run.")}</Text>
      <Stack gap="md">
        <Card withBorder padding="md" data-testid="workflow-card-monthly_interest">
          <Title order={4}>{t("page.WorkflowsIndex.heading.vrf3yw", "Monthly Interest")}</Title>
          <Anchor component={RouterLink} to="/workflows/monthly_interest" data-testid="workflow-monthly_interest-run">{t("page.WorkflowsIndex.anchor.5fm2dg", "Run →")}</Anchor>
        </Card>
        <Card withBorder padding="md" data-testid="workflow-card-open_account">
          <Title order={4}>{t("page.WorkflowsIndex.heading.39wewu", "Open Account")}</Title>
          <Anchor component={RouterLink} to="/workflows/open_account" data-testid="workflow-open_account-run">{t("page.WorkflowsIndex.anchor.5fm2dg", "Run →")}</Anchor>
        </Card>
        <Card withBorder padding="md" data-testid="workflow-card-transfer">
          <Title order={4}>{t("page.WorkflowsIndex.heading.2drbmu", "Transfer")}</Title>
          <Anchor component={RouterLink} to="/workflows/transfer" data-testid="workflow-transfer-run">{t("page.WorkflowsIndex.anchor.5fm2dg", "Run →")}</Anchor>
        </Card>
        <Card withBorder padding="md" data-testid="workflow-card-request_large_transfer">
          <Title order={4}>{t("page.WorkflowsIndex.heading.x6jatk", "Request Large Transfer")}</Title>
          <Anchor component={RouterLink} to="/workflows/request_large_transfer" data-testid="workflow-request_large_transfer-run">{t("page.WorkflowsIndex.anchor.5fm2dg", "Run →")}</Anchor>
        </Card>
        <Card withBorder padding="md" data-testid="workflow-card-approve_transfer">
          <Title order={4}>{t("page.WorkflowsIndex.heading.bp4t8l", "Approve Transfer")}</Title>
          <Anchor component={RouterLink} to="/workflows/approve_transfer" data-testid="workflow-approve_transfer-run">{t("page.WorkflowsIndex.anchor.5fm2dg", "Run →")}</Anchor>
        </Card>
      </Stack>
    </Stack>
  );
}
