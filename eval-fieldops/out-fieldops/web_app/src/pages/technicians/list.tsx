// Auto-generated.  Do not edit by hand.
import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { IdValue, MoneyValue } from "../../lib/format";
import { Alert, Anchor, Breadcrumbs, Button, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllTechnicians } from "../../api/technician";

export default function TechnicianList() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const technicianAll = useAllTechnicians({ page: pageNum, pageSize: 10, sort: sortKey, dir: sortDir });
  return (
    <Stack gap="md" data-testid="technicians-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.26rebs", "Technicians")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.26rebs", "Technicians")}</Title>
        <Button onClick={() => navigate("/technicians/new")} data-testid="technicians-list-create">{t("page.List.button.791ln5", "New technician")}</Button>
      </Group>
      <>
        { technicianAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { technicianAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.l15tcq", "Couldn't load technicians")}</Alert>
        ) }
        { technicianAll.data && technicianAll.data.items.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.gmr5cn", "No technicians yet.")}</Text></Center>
        ) }
        { technicianAll.data && technicianAll.data.items.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "userId") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("userId"); setSortDir("asc"); } }}>{t("page.List.columnHeader.ywrhgr", "User Id")}{sortKey === "userId" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "fullName") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("fullName"); setSortDir("asc"); } }}>{t("page.List.columnHeader.4eocnj", "Full Name")}{sortKey === "fullName" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "costRate") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("costRate"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o103wq", "Cost Rate")}{sortKey === "costRate" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { technicianAll.data.items.map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("technicians-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/technicians/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.userId}</Text></Table.Td>
                    <Table.Td><Text>{row.fullName}</Text></Table.Td>
                    <Table.Td><MoneyValue value={ row.costRate } /></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, technicianAll.data.totalPages) })}</span><button type="button" disabled={pageNum >= Math.max(1, technicianAll.data.totalPages)} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
//# sourceMappingURL=list.tsx.map
