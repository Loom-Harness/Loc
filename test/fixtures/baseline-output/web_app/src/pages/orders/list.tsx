// Auto-generated.  Do not edit by hand.
import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { DateTimeValue, IdValue } from "../../lib/format";
import { Alert, Anchor, Badge, Breadcrumbs, Button, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllOrders } from "../../api/order";

export default function OrderList() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const orderAll = useAllOrders({ page: pageNum, pageSize: 10, sort: sortKey, dir: sortDir });
  return (
    <Stack gap="md" data-testid="orders-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.xf3i18", "Orders")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.xf3i18", "Orders")}</Title>
        <Button onClick={() => navigate("/orders/new")} data-testid="orders-list-create">{t("page.List.button.i38a1x", "New order")}</Button>
      </Group>
      <>
        { orderAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { orderAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.cpshqe", "Couldn't load orders")}</Alert>
        ) }
        { orderAll.data && orderAll.data.items.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.louti1", "No orders yet.")}</Text></Center>
        ) }
        { orderAll.data && orderAll.data.items.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "customerId") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("customerId"); setSortDir("asc"); } }}>{t("page.List.columnHeader.0ysfxy", "Customer Id")}{sortKey === "customerId" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "status") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("status"); setSortDir("asc"); } }}>{t("page.List.columnHeader.03pd73", "Status")}{sortKey === "status" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "placedAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("placedAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.cl05q5", "Placed At")}{sortKey === "placedAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { orderAll.data.items.map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("orders-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/orders/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.customerId}</Text></Table.Td>
                    <Table.Td><Badge tt="none">{ row.status }</Badge></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.placedAt } /></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, orderAll.data.totalPages) })}</span><button type="button" disabled={pageNum >= Math.max(1, orderAll.data.totalPages)} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
