// Auto-generated.  Do not edit by hand.
import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { IdValue } from "../../lib/format";
import { Alert, Anchor, Breadcrumbs, Button, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllSites } from "../../api/site";

export default function SiteList() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const siteAll = useAllSites({ page: pageNum, pageSize: 10, sort: sortKey, dir: sortDir });
  return (
    <Stack gap="md" data-testid="sites-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.iwtnzb", "Sites")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.iwtnzb", "Sites")}</Title>
        <Button onClick={() => navigate("/sites/new")} data-testid="sites-list-create">{t("page.List.button.3z6lt4", "New site")}</Button>
      </Group>
      <>
        { siteAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { siteAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.wr15t1", "Couldn't load sites")}</Alert>
        ) }
        { siteAll.data && siteAll.data.items.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.rbywme", "No sites yet.")}</Text></Center>
        ) }
        { siteAll.data && siteAll.data.items.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "customerId") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("customerId"); setSortDir("asc"); } }}>{t("page.List.columnHeader.0ysfxy", "Customer Id")}{sortKey === "customerId" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "label") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("label"); setSortDir("asc"); } }}>{t("page.List.columnHeader.827q8t", "Label")}{sortKey === "label" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "addressLine") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("addressLine"); setSortDir("asc"); } }}>{t("page.List.columnHeader.1bfr9v", "Address Line")}{sortKey === "addressLine" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { siteAll.data.items.map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("sites-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/sites/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><RouterLink to={`/customers/${ row.customerId }`}><IdValue id={ row.customerId } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.label}</Text></Table.Td>
                    <Table.Td><Text>{row.addressLine}</Text></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, siteAll.data.totalPages) })}</span><button type="button" disabled={pageNum >= Math.max(1, siteAll.data.totalPages)} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
//# sourceMappingURL=list.tsx.map
