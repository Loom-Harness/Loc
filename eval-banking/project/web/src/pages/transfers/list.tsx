// Auto-generated.  Do not edit by hand.
import { useSession } from "../../auth/AuthGate";
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { DateTimeValue, IdValue, MoneyValue } from "../../lib/format";
import { Alert, Anchor, Badge, Breadcrumbs, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllTransfers } from "../../api/transfer";

export default function TransferList() {
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const transferAll = useAllTransfers();
  const currentUser = useSession().user as Record<string, any>;
  if (!(currentUser.role === "teller" || currentUser.role === "compliance")) {
    return (
      <div style={{ padding: 24 }}>
        <h2>Forbidden</h2>
        <p>You do not have access to this page.</p>
      </div>
    );
  }
  return (
    <Stack gap="md" data-testid="transfers-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.oowe33", "Transfers")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.oowe33", "Transfers")}</Title>
      </Group>
      <>
        { transferAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { transferAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.huh3ed", "Couldn't load transfers")}</Alert>
        ) }
        { transferAll.data && transferAll.data.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.nhsbjy", "No transfers yet.")}</Text></Center>
        ) }
        { transferAll.data && transferAll.data.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "reference") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("reference"); setSortDir("asc"); } }}>{t("page.List.columnHeader.c7vrcq", "Reference")}{sortKey === "reference" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "source") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("source"); setSortDir("asc"); } }}>{t("page.List.columnHeader.r5qyuw", "Source")}{sortKey === "source" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "target") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("target"); setSortDir("asc"); } }}>{t("page.List.columnHeader.2ohkdk", "Target")}{sortKey === "target" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "amount") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("amount"); setSortDir("asc"); } }}>{t("page.List.columnHeader.a2ky21", "Amount")}{sortKey === "amount" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "status") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("status"); setSortDir("asc"); } }}>{t("page.List.columnHeader.03pd73", "Status")}{sortKey === "status" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "requestedBy") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("requestedBy"); setSortDir("asc"); } }}>{t("page.List.columnHeader.xwf77s", "Requested By")}{sortKey === "requestedBy" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "requestedAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("requestedAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.0y1dck", "Requested At")}{sortKey === "requestedAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "decidedBy") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("decidedBy"); setSortDir("asc"); } }}>{t("page.List.columnHeader.htnfcc", "Decided By")}{sortKey === "decidedBy" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { ([...(transferAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).slice((pageNum - 1) * 10, pageNum * 10).map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("transfers-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/transfers/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.reference}</Text></Table.Td>
                    <Table.Td><RouterLink to={`/accounts/${ row.source }`}><IdValue id={ row.source } /></RouterLink></Table.Td>
                    <Table.Td><RouterLink to={`/accounts/${ row.target }`}><IdValue id={ row.target } /></RouterLink></Table.Td>
                    <Table.Td><MoneyValue value={ row.amount } /></Table.Td>
                    <Table.Td><Badge tt="none">{ row.status }</Badge></Table.Td>
                    <Table.Td><Text>{row.requestedBy}</Text></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.requestedAt } /></Table.Td>
                    <Table.Td><Text>{row.decidedBy}</Text></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, Math.ceil(([...(transferAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).length / 10)) })}</span><button type="button" disabled={pageNum >= Math.max(1, Math.ceil(([...(transferAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).length / 10))} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
