// Auto-generated.  Do not edit by hand.
import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { IdValue, MoneyValue } from "../../lib/format";
import { Alert, Anchor, Breadcrumbs, Button, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllParts } from "../../api/part";

export default function PartList() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const partAll = useAllParts({ page: pageNum, pageSize: 10, sort: sortKey, dir: sortDir });
  return (
    <Stack gap="md" data-testid="parts-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.cegybp", "Parts")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.cegybp", "Parts")}</Title>
        <Button onClick={() => navigate("/parts/new")} data-testid="parts-list-create">{t("page.List.button.y9b0ji", "New part")}</Button>
      </Group>
      <>
        { partAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { partAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.aapuhf", "Couldn't load parts")}</Alert>
        ) }
        { partAll.data && partAll.data.items.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.c58nvc", "No parts yet.")}</Text></Center>
        ) }
        { partAll.data && partAll.data.items.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "sku") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("sku"); setSortDir("asc"); } }}>{t("page.List.columnHeader.gkg0ca", "Sku")}{sortKey === "sku" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "binCode") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("binCode"); setSortDir("asc"); } }}>{t("page.List.columnHeader.jzz8on", "Bin Code")}{sortKey === "binCode" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "onHand") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("onHand"); setSortDir("asc"); } }}>{t("page.List.columnHeader.t1szj5", "On Hand")}{sortKey === "onHand" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "unitPrice") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("unitPrice"); setSortDir("asc"); } }}>{t("page.List.columnHeader.ha4he2", "Unit Price")}{sortKey === "unitPrice" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "currency") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("currency"); setSortDir("asc"); } }}>{t("page.List.columnHeader.5o3zh2", "Currency")}{sortKey === "currency" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { partAll.data.items.map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("parts-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/parts/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.sku}</Text></Table.Td>
                    <Table.Td><Text>{row.binCode}</Text></Table.Td>
                    <Table.Td><Text>{row.onHand}</Text></Table.Td>
                    <Table.Td><MoneyValue value={ row.unitPrice } /></Table.Td>
                    <Table.Td><Text>{row.currency}</Text></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, partAll.data.totalPages) })}</span><button type="button" disabled={pageNum >= Math.max(1, partAll.data.totalPages)} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
//# sourceMappingURL=list.tsx.map
