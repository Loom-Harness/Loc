// Auto-generated.  Do not edit by hand.
import { useSession } from "../../auth/AuthGate";
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { DateTimeValue, IdValue, MoneyValue } from "../../lib/format";
import { Alert, Anchor, Badge, Breadcrumbs, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllAccounts } from "../../api/account";

export default function AccountList() {
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const accountAll = useAllAccounts();
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
    <Stack gap="md" data-testid="accounts-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.dpi1wd", "Accounts")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.dpi1wd", "Accounts")}</Title>
      </Group>
      <>
        { accountAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { accountAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.2tmr4r", "Couldn't load accounts")}</Alert>
        ) }
        { accountAll.data && accountAll.data.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.sz6zuq", "No accounts yet.")}</Text></Center>
        ) }
        { accountAll.data && accountAll.data.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "number") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("number"); setSortDir("asc"); } }}>{t("page.List.columnHeader.r616tc", "Number")}{sortKey === "number" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "owner") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("owner"); setSortDir("asc"); } }}>{t("page.List.columnHeader.71lv90", "Owner")}{sortKey === "owner" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "accountType") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("accountType"); setSortDir("asc"); } }}>{t("page.List.columnHeader.4dhof0", "Account Type")}{sortKey === "accountType" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "currency") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("currency"); setSortDir("asc"); } }}>{t("page.List.columnHeader.5o3zh2", "Currency")}{sortKey === "currency" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "status") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("status"); setSortDir("asc"); } }}>{t("page.List.columnHeader.03pd73", "Status")}{sortKey === "status" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "balance") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("balance"); setSortDir("asc"); } }}>{t("page.List.columnHeader.kxxksr", "Balance")}{sortKey === "balance" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "interestRate") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("interestRate"); setSortDir("asc"); } }}>{t("page.List.columnHeader.1fn9kr", "Interest Rate")}{sortKey === "interestRate" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "dailyLimit") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("dailyLimit"); setSortDir("asc"); } }}>{t("page.List.columnHeader.j7opvt", "Daily Limit")}{sortKey === "dailyLimit" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "withdrawnToday") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("withdrawnToday"); setSortDir("asc"); } }}>{t("page.List.columnHeader.3veuiy", "Withdrawn Today")}{sortKey === "withdrawnToday" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "limitDay") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("limitDay"); setSortDir("asc"); } }}>{t("page.List.columnHeader.2y4zee", "Limit Day")}{sortKey === "limitDay" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "openedAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("openedAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.3jq1z9", "Opened At")}{sortKey === "openedAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { ([...(accountAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).slice((pageNum - 1) * 10, pageNum * 10).map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("accounts-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/accounts/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.number}</Text></Table.Td>
                    <Table.Td><RouterLink to={`/customers/${ row.owner }`}><IdValue id={ row.owner } /></RouterLink></Table.Td>
                    <Table.Td><Badge tt="none">{ row.accountType }</Badge></Table.Td>
                    <Table.Td><Text>{row.currency}</Text></Table.Td>
                    <Table.Td><Badge tt="none">{ row.status }</Badge></Table.Td>
                    <Table.Td><MoneyValue value={ row.balance } /></Table.Td>
                    <Table.Td><Text>{row.interestRate}</Text></Table.Td>
                    <Table.Td><MoneyValue value={ row.dailyLimit } /></Table.Td>
                    <Table.Td><MoneyValue value={ row.withdrawnToday } /></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.limitDay } /></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.openedAt } /></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, Math.ceil(([...(accountAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).length / 10)) })}</span><button type="button" disabled={pageNum >= Math.max(1, Math.ceil(([...(accountAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).length / 10))} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
