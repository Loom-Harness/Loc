// Auto-generated.  Do not edit by hand.
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { DateTimeValue, IdValue, MoneyValue } from "../../lib/format";
import { Alert, Anchor, Breadcrumbs, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllInvoices } from "../../api/invoice";

export default function InvoiceList() {
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const invoiceAll = useAllInvoices({ page: pageNum, pageSize: 10, sort: sortKey, dir: sortDir });
  return (
    <Stack gap="md" data-testid="invoices-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.7b7gu1", "Invoices")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.7b7gu1", "Invoices")}</Title>
      </Group>
      <>
        { invoiceAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { invoiceAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.zlus8n", "Couldn't load invoices")}</Alert>
        ) }
        { invoiceAll.data && invoiceAll.data.items.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.znv2ji", "No invoices yet.")}</Text></Center>
        ) }
        { invoiceAll.data && invoiceAll.data.items.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "workOrderId") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("workOrderId"); setSortDir("asc"); } }}>{t("page.List.columnHeader.cyjwdx", "Work Order Id")}{sortKey === "workOrderId" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "issuedAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("issuedAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.hmhrht", "Issued At")}{sortKey === "issuedAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "amount") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("amount"); setSortDir("asc"); } }}>{t("page.List.columnHeader.a2ky21", "Amount")}{sortKey === "amount" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "currency") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("currency"); setSortDir("asc"); } }}>{t("page.List.columnHeader.5o3zh2", "Currency")}{sortKey === "currency" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "createdAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("createdAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.1byjss", "Created At")}{sortKey === "createdAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "updatedAt") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("updatedAt"); setSortDir("asc"); } }}>{t("page.List.columnHeader.wy0gb9", "Updated At")}{sortKey === "updatedAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "createdBy") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("createdBy"); setSortDir("asc"); } }}>{t("page.List.columnHeader.2q60rk", "Created By")}{sortKey === "createdBy" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "updatedBy") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("updatedBy"); setSortDir("asc"); } }}>{t("page.List.columnHeader.0yv6gt", "Updated By")}{sortKey === "updatedBy" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { invoiceAll.data.items.map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("invoices-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/invoices/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><RouterLink to={`/work_orders/${ row.workOrderId }`}><IdValue id={ row.workOrderId } /></RouterLink></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.issuedAt } /></Table.Td>
                    <Table.Td><MoneyValue value={ row.amount } /></Table.Td>
                    <Table.Td><Text>{row.currency}</Text></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.createdAt } /></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.updatedAt } /></Table.Td>
                    <Table.Td><RouterLink to={`/users/${ row.createdBy }`}><IdValue id={ row.createdBy } /></RouterLink></Table.Td>
                    <Table.Td><RouterLink to={`/users/${ row.updatedBy }`}><IdValue id={ row.updatedBy } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, invoiceAll.data.totalPages) })}</span><button type="button" disabled={pageNum >= Math.max(1, invoiceAll.data.totalPages)} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
//# sourceMappingURL=list.tsx.map
