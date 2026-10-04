// Auto-generated.  Do not edit by hand.
import { useSession } from "../../../auth/AuthGate";
import { Link as RouterLink } from "react-router";
import { t } from "../../../i18n";
import { Alert, Anchor, Breadcrumbs, Center, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllMonthlyInterestInstances } from "../../../api/workflows";

export default function MonthlyInterestInstancesList() {
  const allMonthlyInterestInstances = useAllMonthlyInterestInstances();
  const currentUser = useSession().user as Record<string, any>;
  if (!(currentUser.role === "compliance")) {
    return (
      <div style={{ padding: 24 }}>
        <h2>Forbidden</h2>
        <p>You do not have access to this page.</p>
      </div>
    );
  }
  return (
    <Stack gap="md" data-testid="monthly_interest-instances-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.MonthlyInterestInstancesList.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.MonthlyInterestInstancesList.text.qrue75", "Workflows")}</Text>
        <Text>{t("page.MonthlyInterestInstancesList.text.x60c9s", "Monthly Interest instances")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.MonthlyInterestInstancesList.heading.x60c9s", "Monthly Interest instances")}</Title>
      <>
        { allMonthlyInterestInstances.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { allMonthlyInterestInstances.isError && (
          <Alert color="red" variant="light">{t("page.MonthlyInterestInstancesList.alert.61d2mq", "Couldn't load monthly interest instances")}</Alert>
        ) }
        { allMonthlyInterestInstances.data && allMonthlyInterestInstances.data.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.MonthlyInterestInstancesList.empty.yvuswx", "No monthly interest instances yet.")}</Text></Center>
        ) }
        { allMonthlyInterestInstances.data && allMonthlyInterestInstances.data.length > 0 && (
          <Paper p="md">
            <div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("page.MonthlyInterestInstancesList.columnHeader.37u7vu", "Run")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { allMonthlyInterestInstances.data.map((row) => (
                  <Table.Tr key={ row.run } data-testid={ ("monthly_interest-instances-row-" + row.run) }>
                    <Table.Td><Anchor component={RouterLink} to={("/workflows/monthly_interest/instances/" + row.run)}>{row.run}</Anchor></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
