// Auto-generated.  Do not edit by hand.
import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { DateTimeValue, IdValue } from "../../lib/format";
import { Alert, Anchor, Badge, Breadcrumbs, Button, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllWorkOrders } from "../../api/workOrder";

export default function WorkOrderList() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const workOrderAll = useAllWorkOrders({ page: pageNum, pageSize: 10, sort: sortKey, dir: sortDir });
  return (
    <Stack gap="md" data-testid="work_orders-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.dodp9t", "Work Orders")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.dodp9t", "Work Orders")}</Title>
        <Button onClick={() => navigate("/work_orders/new")} data-testid="work_orders-list-create">{t("page.List.button.nn8agi", "New work order")}</Button>
      </Group>
      <>
        { workOrderAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { workOrderAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.lidtwf", "Couldn't load work orders")}</Alert>
        ) }
        { workOrderAll.data && workOrderAll.data.items.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.g0d4us", "No work orders yet.")}</Text></Center>
        ) }
        { workOrderAll.data && workOrderAll.data.items.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "customerId") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("customerId"); setSortDir("asc"); } }}>{t("page.List.columnHeader.0ysfxy", "Customer Id")}{sortKey === "customerId" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "siteId") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("siteId"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q4n5gn", "Site Id")}{sortKey === "siteId" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "assetId") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("assetId"); setSortDir("asc"); } }}>{t("page.List.columnHeader.fxygok", "Asset Id")}{sortKey === "assetId" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "technicianId") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("technicianId"); setSortDir("asc"); } }}>{t("page.List.columnHeader.ppl8uc", "Technician Id")}{sortKey === "technicianId" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "technicianUserId") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("technicianUserId"); setSortDir("asc"); } }}>{t("page.List.columnHeader.ctm2gn", "Technician User Id")}{sortKey === "technicianUserId" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "status") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("status"); setSortDir("asc"); } }}>{t("page.List.columnHeader.03pd73", "Status")}{sortKey === "status" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "priority") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("priority"); setSortDir("asc"); } }}>{t("page.List.columnHeader.ryxjjd", "Priority")}{sortKey === "priority" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "currency") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("currency"); setSortDir("asc"); } }}>{t("page.List.columnHeader.5o3zh2", "Currency")}{sortKey === "currency" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "scheduledAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("scheduledAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.qg7sx9", "Scheduled At")}{sortKey === "scheduledAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "startedAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("startedAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.r4aslr", "Started At")}{sortKey === "startedAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "completedAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("completedAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.b280cz", "Completed At")}{sortKey === "completedAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "resolutionNote") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("resolutionNote"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0z6ut", "Resolution Note")}{sortKey === "resolutionNote" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { workOrderAll.data.items.map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("work_orders-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/work_orders/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><RouterLink to={`/customers/${ row.customerId }`}><IdValue id={ row.customerId } /></RouterLink></Table.Td>
                    <Table.Td><RouterLink to={`/sites/${ row.siteId }`}><IdValue id={ row.siteId } /></RouterLink></Table.Td>
                    <Table.Td><RouterLink to={`/assets/${ row.assetId }`}><IdValue id={ row.assetId } /></RouterLink></Table.Td>
                    <Table.Td><RouterLink to={`/technicians/${ row.technicianId }`}><IdValue id={ row.technicianId } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.technicianUserId}</Text></Table.Td>
                    <Table.Td><Badge tt="none">{ row.status }</Badge></Table.Td>
                    <Table.Td><Badge tt="none">{ row.priority }</Badge></Table.Td>
                    <Table.Td><Text>{row.currency}</Text></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.scheduledAt } /></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.startedAt } /></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.completedAt } /></Table.Td>
                    <Table.Td><Text>{row.resolutionNote}</Text></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, workOrderAll.data.totalPages) })}</span><button type="button" disabled={pageNum >= Math.max(1, workOrderAll.data.totalPages)} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
