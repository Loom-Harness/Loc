// Auto-generated.  Do not edit by hand.
import { useSession } from "../../auth/AuthGate";
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { DateTimeValue, IdValue } from "../../lib/format";
import { Alert, Anchor, Breadcrumbs, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllInterestRuns } from "../../api/interestRun";

export default function InterestRunList() {
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const interestRunAll = useAllInterestRuns();
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
    <Stack gap="md" data-testid="interest_runs-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.ue0tbz", "Interest Runs")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.ue0tbz", "Interest Runs")}</Title>
      </Group>
      <>
        { interestRunAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { interestRunAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.q7xk1x", "Couldn't load interest runs")}</Alert>
        ) }
        { interestRunAll.data && interestRunAll.data.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.269bn6", "No interest runs yet.")}</Text></Center>
        ) }
        { interestRunAll.data && interestRunAll.data.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "startedAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("startedAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.r4aslr", "Started At")}{sortKey === "startedAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { ([...(interestRunAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).slice((pageNum - 1) * 10, pageNum * 10).map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("interest_runs-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/interest_runs/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.startedAt } /></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, Math.ceil(([...(interestRunAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).length / 10)) })}</span><button type="button" disabled={pageNum >= Math.max(1, Math.ceil(([...(interestRunAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).length / 10))} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
