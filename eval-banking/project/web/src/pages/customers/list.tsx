// Auto-generated.  Do not edit by hand.
import { useSession } from "../../auth/AuthGate";
import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { IdValue } from "../../lib/format";
import { Alert, Anchor, Breadcrumbs, Button, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllCustomers } from "../../api/customer";

export default function CustomerList() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const customerAll = useAllCustomers();
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
    <Stack gap="md" data-testid="customers-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.vweyym", "Customers")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.vweyym", "Customers")}</Title>
        <Button onClick={() => navigate("/customers/new")} data-testid="customers-list-create">{t("page.List.button.cq54sn", "New customer")}</Button>
      </Group>
      <>
        { customerAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { customerAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.4hka48", "Couldn't load customers")}</Alert>
        ) }
        { customerAll.data && customerAll.data.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.u6pr2h", "No customers yet.")}</Text></Center>
        ) }
        { customerAll.data && customerAll.data.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "firstName") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("firstName"); setSortDir("asc"); } }}>{t("page.List.columnHeader.6yjm7s", "First Name")}{sortKey === "firstName" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "lastName") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("lastName"); setSortDir("asc"); } }}>{t("page.List.columnHeader.6p3u1s", "Last Name")}{sortKey === "lastName" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "email") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("email"); setSortDir("asc"); } }}>{t("page.List.columnHeader.inbfc7", "Email")}{sortKey === "email" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { ([...(customerAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).slice((pageNum - 1) * 10, pageNum * 10).map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("customers-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/customers/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.firstName}</Text></Table.Td>
                    <Table.Td><Text>{row.lastName}</Text></Table.Td>
                    <Table.Td><Text>{row.email}</Text></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, Math.ceil(([...(customerAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).length / 10)) })}</span><button type="button" disabled={pageNum >= Math.max(1, Math.ceil(([...(customerAll.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).length / 10))} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
