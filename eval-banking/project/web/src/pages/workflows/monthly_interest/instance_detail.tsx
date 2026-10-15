// Auto-generated.  Do not edit by hand.
import { useSession } from "../../../auth/AuthGate";
import { useParams, Link as RouterLink } from "react-router";
import { t } from "../../../i18n";
import { IdValue, KeyValueRow } from "../../../lib/format";
import { Alert, Anchor, Breadcrumbs, Card, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useMonthlyInterestInstanceById } from "../../../api/workflows";

export default function MonthlyInterestInstanceDetail() {
  const { id } = useParams<{ id: string }>();
  const monthlyInterestInstance = useMonthlyInterestInstanceById(id);
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
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.MonthlyInterestInstanceDetail.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.MonthlyInterestInstanceDetail.text.qrue75", "Workflows")}</Text>
        <Anchor component={RouterLink} to="/workflows/monthly_interest/instances">{t("page.MonthlyInterestInstanceDetail.anchor.x60c9s", "Monthly Interest instances")}</Anchor>
        <Text>{t("page.MonthlyInterestInstanceDetail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.MonthlyInterestInstanceDetail.heading.uwmkur", "Monthly Interest instance")}</Title>
      <>
        { monthlyInterestInstance.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { monthlyInterestInstance.isError && (
          <Alert color="red" variant="light">{t("page.MonthlyInterestInstanceDetail.alert.hiy6tx", "Couldn't load monthly interest instance")}</Alert>
        ) }
        { !monthlyInterestInstance.isLoading && !monthlyInterestInstance.isError && !monthlyInterestInstance.data && (
          <Alert color="yellow" variant="light">{t("page.MonthlyInterestInstanceDetail.alert.103mu9", "No monthly interest instance matches that id.")}</Alert>
        ) }
        { monthlyInterestInstance.data && (
          <Card withBorder padding="md">
            <KeyValueRow label={t("page.MonthlyInterestInstanceDetail.keyValue.37u7vu", "Run")}><RouterLink to={`/interest_runs/${ monthlyInterestInstance.data.run }`}><IdValue id={ monthlyInterestInstance.data.run } /></RouterLink></KeyValueRow>
          </Card>
        ) }
      </>
    </Stack>
  );
}
