// Auto-generated.  Do not edit by hand.
import { useParams, Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { DateTimeValue, KeyValueRow } from "../../lib/format";
import { Alert, Anchor, Breadcrumbs, Card, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useInterestRunById } from "../../api/interestRun";

export default function InterestRunDetail() {
  const { id } = useParams<{ id: string }>();
  const interestRunById = useInterestRunById(id);
  return (
    <Stack gap="md" data-testid="interest_runs-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/interest_runs">{t("page.Detail.anchor.ue0tbz", "Interest Runs")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.vme6kz", "Interest Run detail")}</Title>
      <>
        { interestRunById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { interestRunById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.xwht10", "Couldn't load interest run")}</Alert>
        ) }
        { !interestRunById.isLoading && !interestRunById.isError && !interestRunById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.dj4yqg", "No interest run matches that id.")}</Alert>
        ) }
        { interestRunById.data && (
          <Card withBorder padding="md">
            <Stack gap="md">
              <KeyValueRow label={t("page.Detail.keyValue.r4aslr", "Started At")} data-testid="interest_runs-detail-startedAt"><DateTimeValue iso={ interestRunById.data.startedAt } /></KeyValueRow>
              <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="interest_runs-detail-version"><Text>{interestRunById.data.version}</Text></KeyValueRow>
            </Stack>
          </Card>
        ) }
      </>
    </Stack>
  );
}
