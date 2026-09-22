// Auto-generated.  Do not edit by hand.
import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { DateTimeValue, IdValue } from "../../lib/format";
import { Alert, Anchor, Breadcrumbs, Button, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllCustomers } from "../../api/customer";

export default function CustomerList() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const customerAll = useAllCustomers({ page: pageNum, pageSize: 10, sort: sortKey, dir: sortDir });
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
        { customerAll.data && customerAll.data.items.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.u6pr2h", "No customers yet.")}</Text></Center>
        ) }
        { customerAll.data && customerAll.data.items.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "name") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("name"); setSortDir("asc"); } }}>{t("page.List.columnHeader.4el6o6", "Name")}{sortKey === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "contactEmail") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("contactEmail"); setSortDir("asc"); } }}>{t("page.List.columnHeader.x3xnez", "Contact Email")}{sortKey === "contactEmail" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "createdAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("createdAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.1byjss", "Created At")}{sortKey === "createdAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "updatedAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("updatedAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.wy0gb9", "Updated At")}{sortKey === "updatedAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "createdBy") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("createdBy"); setSortDir("asc"); } }}>{t("page.List.columnHeader.2q60rk", "Created By")}{sortKey === "createdBy" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "updatedBy") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("updatedBy"); setSortDir("asc"); } }}>{t("page.List.columnHeader.0yv6gt", "Updated By")}{sortKey === "updatedBy" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { customerAll.data.items.map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("customers-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/customers/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.name}</Text></Table.Td>
                    <Table.Td><Text>{row.contactEmail}</Text></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.createdAt } /></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.updatedAt } /></Table.Td>
                    <Table.Td><RouterLink to={`/users/${ row.createdBy }`}><IdValue id={ row.createdBy } /></RouterLink></Table.Td>
                    <Table.Td><RouterLink to={`/users/${ row.updatedBy }`}><IdValue id={ row.updatedBy } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, customerAll.data.totalPages) })}</span><button type="button" disabled={pageNum >= Math.max(1, customerAll.data.totalPages)} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
//# sourceMappingURL=list.tsx.map
