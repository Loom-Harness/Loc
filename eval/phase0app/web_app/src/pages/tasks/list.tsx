// Auto-generated.  Do not edit by hand.
import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router";
import { t } from "../../i18n";
import { IdValue } from "../../lib/format";
import { Alert, Anchor, Breadcrumbs, Button, Center, Group, Paper, Skeleton, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useAllTasks, useByProjectTask } from "../../api/task";

export default function TaskList() {
  const navigate = useNavigate();
  const [byProjectProjectId, setByProjectProjectId] = useState<string>("");
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<string>("");
  const [pageNum, setPageNum] = useState<number>(1);
  const taskByProject = useByProjectTask({ projectId: byProjectProjectId });
  const taskAll = useAllTasks({ page: pageNum, pageSize: 10, sort: sortKey, dir: sortDir });
  return (
    <Stack gap="md" data-testid="tasks-list">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.List.anchor.n0mxf2", "Home")}</Anchor>
        <Text>{t("page.List.text.fzjmnh", "Tasks")}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center" gap="md" role="toolbar" aria-label="Actions">
        <Title order={2}>{t("page.List.heading.fzjmnh", "Tasks")}</Title>
        <Button onClick={() => navigate("/tasks/new")} data-testid="tasks-list-create">{t("page.List.button.sc40ki", "New task")}</Button>
      </Group>
      <Group gap="xs">
        <TextInput label={t("page.List.inputLabel.zoawvr", "Project Id")} value={byProjectProjectId} onChange={(e) => setByProjectProjectId(e.currentTarget.value)} data-testid="tasks-filter-by_project_project_id" />
      </Group>
      {((byProjectProjectId !== "")) ? (<>
          { taskByProject.isLoading && (
            <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
          ) }
          { taskByProject.isError && (
            <Alert color="red" variant="light">{t("page.List.alert.oq240v", "Couldn't load tasks")}</Alert>
          ) }
          { taskByProject.data && taskByProject.data.length === 0 && (
            <Center mih={200}><Text c="dimmed">{t("page.List.empty.yuvx58", "No tasks yet.")}</Text></Center>
          ) }
          { taskByProject.data && taskByProject.data.length > 0 && (
            <Paper p="md">
              <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                    <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "title") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("title"); setSortDir("asc"); } }}>{t("page.List.columnHeader.a7vsmh", "Title")}{sortKey === "title" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                    <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "done") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("done"); setSortDir("asc"); } }}>{t("page.List.columnHeader.3cn9g1", "Done")}{sortKey === "done" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                    <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "project") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("project"); setSortDir("asc"); } }}>{t("page.List.columnHeader.y8csbi", "Project")}{sortKey === "project" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                    <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  { ([...(taskByProject.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).slice((pageNum - 1) * 10, pageNum * 10).map((row) => (
                    <Table.Tr key={ row.id } data-testid={ ("tasks-row-" + row.id) }>
                      <Table.Td><RouterLink to={`/tasks/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                      <Table.Td><Text>{row.title}</Text></Table.Td>
                      <Table.Td><Text>{(row.done ? "Yes" : "No")}</Text></Table.Td>
                      <Table.Td><RouterLink to={`/projects/${ row.project }`}><IdValue id={ row.project } /></RouterLink></Table.Td>
                      <Table.Td><Text>{row.version}</Text></Table.Td>
                    </Table.Tr>
                  )) }
                </Table.Tbody>
              </Table></div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, Math.ceil(([...(taskByProject.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).length / 10)) })}</span><button type="button" disabled={pageNum >= Math.max(1, Math.ceil(([...(taskByProject.data)].sort((a, b) => { if (!sortKey) { return 0; } const sv = (v: unknown) => (v === null || typeof v !== "object" || Array.isArray(v)) ? v : (Number.isNaN(Number(v)) ? v : Number(v)); const av = sv((a as Record<string, unknown>)[sortKey]); const bv = sv((b as Record<string, unknown>)[sortKey]); const c = av === bv ? 0 : (av as number) < (bv as number) ? -1 : 1; return sortDir === "desc" ? -c : c; })).length / 10))} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
            </Paper>
          ) }
        </>) : <>
          { taskAll.isLoading && (
            <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
          ) }
          { taskAll.isError && (
            <Alert color="red" variant="light">{t("page.List.alert.oq240v", "Couldn't load tasks")}</Alert>
          ) }
          { taskAll.data && taskAll.data.items.length === 0 && (
            <Center mih={200}><Text c="dimmed">{t("page.List.empty.yuvx58", "No tasks yet.")}</Text></Center>
          ) }
          { taskAll.data && taskAll.data.items.length > 0 && (
            <Paper p="md">
              <><div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "id") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("id"); setSortDir("asc"); } }}>{t("page.List.columnHeader.o4495s", "ID")}{sortKey === "id" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                    <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "title") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("title"); setSortDir("asc"); } }}>{t("page.List.columnHeader.a7vsmh", "Title")}{sortKey === "title" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                    <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "done") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("done"); setSortDir("asc"); } }}>{t("page.List.columnHeader.3cn9g1", "Done")}{sortKey === "done" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                    <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "project") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("project"); setSortDir("asc"); } }}>{t("page.List.columnHeader.y8csbi", "Project")}{sortKey === "project" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                    <Table.Th><button type="button" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", userSelect: "none" }} onClick={() => { if (sortKey === "version") { setSortDir(sortDir === "asc" ? "desc" : "asc"); } else { setSortKey("version"); setSortDir("asc"); } }}>{t("page.List.columnHeader.q0zd4n", "Version")}{sortKey === "version" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  { taskAll.data.items.map((row) => (
                    <Table.Tr key={ row.id } data-testid={ ("tasks-row-" + row.id) }>
                      <Table.Td><RouterLink to={`/tasks/${ row.id }`}><IdValue id={ row.id } /></RouterLink></Table.Td>
                      <Table.Td><Text>{row.title}</Text></Table.Td>
                      <Table.Td><Text>{(row.done ? "Yes" : "No")}</Text></Table.Td>
                      <Table.Td><RouterLink to={`/projects/${ row.project }`}><IdValue id={ row.project } /></RouterLink></Table.Td>
                      <Table.Td><Text>{row.version}</Text></Table.Td>
                    </Table.Tr>
                  )) }
                </Table.Tbody>
              </Table></div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }} data-testid="pager"><button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>{t("chrome.prev", "Prev")}</button><span>{t("chrome.pageOf", "Page {page} of {pages}", { page: pageNum, pages: Math.max(1, taskAll.data.totalPages) })}</span><button type="button" disabled={pageNum >= Math.max(1, taskAll.data.totalPages)} onClick={() => setPageNum(pageNum + 1)}>{t("chrome.next", "Next")}</button></div></>
            </Paper>
          ) }
        </>}
    </Stack>
  );
}
