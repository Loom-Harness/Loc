// Auto-generated.  Do not edit by hand.
import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { DateTimeValue, IdValue } from "../../lib/format";
import { Alert, Anchor, Breadcrumbs, Button, Center, Group, Paper, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useAllAssets } from "../../api/asset";

export default function AssetList() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const assetAll = useAllAssets({ page: pageNum, pageSize: 10, sort: sortKey, dir: sortDir });
  return (
    <Stack gap="md" data-testid="assets-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.shidso", "Assets")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.shidso", "Assets")}</Title>
        <Button onClick={() => navigate("/assets/new")} data-testid="assets-list-create">{t("page.List.button.mkyo6t", "New asset")}</Button>
      </Group>
      <>
        { assetAll.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { assetAll.isError && (
          <Alert color="red" variant="light">{t("page.List.alert.foxice", "Couldn't load assets")}</Alert>
        ) }
        { assetAll.data && assetAll.data.items.length === 0 && (
          <Center mih={200}><Text c="dimmed">{t("page.List.empty.i8mn1x", "No assets yet.")}</Text></Center>
        ) }
        { assetAll.data && assetAll.data.items.length > 0 && (
          <Paper p="md">
            <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "siteId") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("siteId"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q4n5gn", "Site Id")}{sortKey === "siteId" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "requiredSkill") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("requiredSkill"); setSortDir("asc"); } }}>{t("page.List.columnHeader.3oiuwt", "Required Skill")}{sortKey === "requiredSkill" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "serialNumber") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("serialNumber"); setSortDir("asc"); } }}>{t("page.List.columnHeader.0wq722", "Serial Number")}{sortKey === "serialNumber" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "model") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("model"); setSortDir("asc"); } }}>{t("page.List.columnHeader.07rbay", "Model")}{sortKey === "model" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "warrantyExpiry") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("warrantyExpiry"); setSortDir("asc"); } }}>{t("page.List.columnHeader.doifvo", "Warranty Expiry")}{sortKey === "warrantyExpiry" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                { assetAll.data.items.map((row) => (
                  <Table.Tr key={ row.id } data-testid={ ("assets-row-" + row.id) }>
                    <Table.Td><RouterLink to={`/assets/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                    <Table.Td><RouterLink to={`/sites/${ row.siteId }`}><IdValue id={ row.siteId } /></RouterLink></Table.Td>
                    <Table.Td><Text>{row.requiredSkill}</Text></Table.Td>
                    <Table.Td><Text>{row.serialNumber}</Text></Table.Td>
                    <Table.Td><Text>{row.model}</Text></Table.Td>
                    <Table.Td><DateTimeValue iso={ row.warrantyExpiry } /></Table.Td>
                    <Table.Td><Text>{row.version}</Text></Table.Td>
                  </Table.Tr>
                )) }
              </Table.Tbody>
            </Table></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, assetAll.data.totalPages) })}</span><button type="button" disabled={pageNum >= Math.max(1, assetAll.data.totalPages)} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
          </Paper>
        ) }
      </>
    </Stack>
  );
}
