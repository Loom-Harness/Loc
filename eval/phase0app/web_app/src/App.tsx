// Auto-generated.
import { Routes, Route, Link as RouterLink, useLocation, Outlet } from "react-router";
import { AppShell, Burger, Group, Title, NavLink, Anchor, Alert, Button, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { t } from "./i18n";
import Home from "./pages/home";
import ProjectList from "./pages/projects/list";
import ProjectNew from "./pages/projects/new";
import ProjectDetail from "./pages/projects/detail";
import TaskList from "./pages/tasks/list";
import TaskNew from "./pages/tasks/new";
import TaskDetail from "./pages/tasks/detail";

// App-level error boundary catches render-time crashes from any
// page component.  Without it, an unhandled exception inside
// e.g. a detail page would blank the entire shell and leave the
// user with no path back.  Reset on click navigates back to the
// home route, matching the expectation that "the dashboard
// keeps working when one page is broken".
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("App error boundary caught:", error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <Stack data-testid="app-error" p="md">
          <Alert color="red" title={t("chrome.somethingWentWrong", "Something went wrong")}>
            {this.state.error.message}
          </Alert>
          <Group>
            <Button
              variant="default"
              onClick={() => {
                this.setState({ error: null });
                window.location.assign("/");
              }}
            >
              {t("chrome.backToHome", "Back to home")}
            </Button>
          </Group>
        </Stack>
      );
    }
    return this.props.children;
  }
}

function NotFound() {
  return (
    <Stack data-testid="not-found" p="md">
      <Title order={2}>{t("chrome.notFound", "Not found")}</Title>
      <Anchor component={RouterLink} to="/">← {t("chrome.backToHome", "Back to home")}</Anchor>
    </Stack>
  );
}

// Active-route helper — drives NavLink's `active` prop.  Defaults
// to a prefix match so /orders/<id> + /orders/new + /orders all
// keep the "Orders" link highlighted; the `exact` opt-in narrows
// to literal equality (used by /workflows + /views index links so
// they don't shadow their per-item children).
function useIsActive() {
  const location = useLocation();
  return (path: string, opts?: { exact?: boolean }) => {
    if (opts?.exact) return location.pathname === path;
    return (
      location.pathname === path || location.pathname.startsWith(path + "/")
    );
  };
}

// Default app chrome — header + sidebar + main with an Outlet that
// React Router fills with the active in-shell child route.  Pages
// declared with `layout: none` mount as sibling routes outside this
// wrapper (see `App()` below) so they get no header / sidebar /
// padding.
function AppShellLayout() {
  const isActive = useIsActive();
  const [opened, { toggle, close }] = useDisclosure();
  // Mobile UX: auto-close the navbar drawer after a route change.
  // Tapping a NavLink on a phone otherwise leaves the menu covering
  // the destination page, which is contrary to how every other
  // mobile app behaves.  Desktop is unaffected — the navbar isn't
  // collapsible above the `sm` breakpoint, so close() is a no-op there.
  const location = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: close() from useDisclosure is reference-stable; intentionally omitted to avoid re-firing on unrelated re-renders.
  React.useEffect(() => {
    close();
  }, [location.pathname]);
  return (
    <>
      {/* Skip link (WCAG 2.4.1 Bypass Blocks) — first focusable element,
          visually hidden until focused, jumps to the <main> landmark. */}
      <a href="#main-content" className="loom-skip-link">{t("chrome.skipToContent", "Skip to content")}</a>
      <style>{`.loom-skip-link{position:absolute;left:-9999px;top:0;z-index:1000;padding:8px 16px;background:var(--mantine-color-body);color:var(--mantine-color-text);border:1px solid var(--mantine-color-default-border);border-radius:4px}.loom-skip-link:focus{left:8px;top:8px}.loom-nav-section{font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--mantine-color-dimmed);margin:8px 0 4px}.loom-breadcrumbs>*:not(:last-child)::after{content:"/";margin-inline-start:8px;opacity:.5}`}</style>
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding={{ base: "md", lg: "lg" }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              data-testid="nav-burger"
            />
            <Anchor component={RouterLink} to="/" underline="never" c="inherit">
              <Group gap={8} align="center">
                <div style={{ width: 28, height: 28, borderRadius: 6, background: "var(--mantine-color-brand-6)" }} aria-hidden="true" />
                <Title order={4} style={{ letterSpacing: "-0.01em" }}>Phase0app</Title>
              </Group>
            </Anchor>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md" aria-label={t("chrome.primaryNav", "Primary navigation")}>
        <Stack gap={4} data-testid="nav-sidebar">
          <div className="loom-nav-section">Aggregates</div>
          <NavLink component={RouterLink} to="/projects" label="Projects" active={isActive("/projects")} data-testid="nav-projects" />
          <NavLink component={RouterLink} to="/tasks" label="Tasks" active={isActive("/tasks")} data-testid="nav-tasks" />
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main id="main-content" style={{ minWidth: 0 }}>
        <AppErrorBoundary>
          <Outlet />
        </AppErrorBoundary>
      </AppShell.Main>
    </AppShell>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShellLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<ProjectList />} />
        <Route path="/projects/new" element={<ProjectNew />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/tasks" element={<TaskList />} />
        <Route path="/tasks/new" element={<TaskNew />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
