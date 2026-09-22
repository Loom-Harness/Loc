// Auto-generated.
import { Routes, Route, Link as RouterLink, useLocation, Outlet } from "react-router";
import { AppShell, Burger, Group, Title, NavLink, Anchor, Alert, Button, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { t } from "./i18n";
import Home from "./pages/home";
import OrganizationList from "./pages/organizations/list";
import OrganizationNew from "./pages/organizations/new";
import OrganizationDetail from "./pages/organizations/detail";
import CustomerList from "./pages/customers/list";
import CustomerNew from "./pages/customers/new";
import CustomerDetail from "./pages/customers/detail";
import SiteList from "./pages/sites/list";
import SiteNew from "./pages/sites/new";
import SiteDetail from "./pages/sites/detail";
import AssetList from "./pages/assets/list";
import AssetNew from "./pages/assets/new";
import AssetDetail from "./pages/assets/detail";
import TechnicianList from "./pages/technicians/list";
import TechnicianNew from "./pages/technicians/new";
import TechnicianDetail from "./pages/technicians/detail";
import PartList from "./pages/parts/list";
import PartNew from "./pages/parts/new";
import PartDetail from "./pages/parts/detail";
import WorkOrderList from "./pages/work_orders/list";
import WorkOrderNew from "./pages/work_orders/new";
import WorkOrderDetail from "./pages/work_orders/detail";
import InvoiceList from "./pages/invoices/list";
import InvoiceDetail from "./pages/invoices/detail";
import WorkflowsIndex from "./pages/workflows/index";
import ScheduleWorkOrderWorkflowPage from "./pages/workflows/schedule_work_order";

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
                <Title order={4} style={{ letterSpacing: "-0.01em" }}>Field Ops</Title>
              </Group>
            </Anchor>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md" aria-label={t("chrome.primaryNav", "Primary navigation")}>
        <Stack gap={4} data-testid="nav-sidebar">
          <div className="loom-nav-section">Aggregates</div>
          <NavLink component={RouterLink} to="/organizations" label="Organizations" active={isActive("/organizations")} data-testid="nav-organizations" />
          <NavLink component={RouterLink} to="/customers" label="Customers" active={isActive("/customers")} data-testid="nav-customers" />
          <NavLink component={RouterLink} to="/sites" label="Sites" active={isActive("/sites")} data-testid="nav-sites" />
          <NavLink component={RouterLink} to="/assets" label="Assets" active={isActive("/assets")} data-testid="nav-assets" />
          <NavLink component={RouterLink} to="/technicians" label="Technicians" active={isActive("/technicians")} data-testid="nav-technicians" />
          <NavLink component={RouterLink} to="/parts" label="Parts" active={isActive("/parts")} data-testid="nav-parts" />
          <NavLink component={RouterLink} to="/work_orders" label="Work Orders" active={isActive("/work_orders")} data-testid="nav-work_orders" />
          <NavLink component={RouterLink} to="/invoices" label="Invoices" active={isActive("/invoices")} data-testid="nav-invoices" />
          <div className="loom-nav-section">Workflows</div>
          <NavLink component={RouterLink} to="/workflows" label="All workflows" active={isActive("/workflows", { exact: true })} data-testid="nav-workflows" />
          <NavLink component={RouterLink} to="/workflows/schedule_work_order" label="Schedule Work Order" active={isActive("/workflows/schedule_work_order")} data-testid="nav-workflow-schedule_work_order" />
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
        <Route path="/organizations" element={<OrganizationList />} />
        <Route path="/organizations/new" element={<OrganizationNew />} />
        <Route path="/organizations/:id" element={<OrganizationDetail />} />
        <Route path="/customers" element={<CustomerList />} />
        <Route path="/customers/new" element={<CustomerNew />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/sites" element={<SiteList />} />
        <Route path="/sites/new" element={<SiteNew />} />
        <Route path="/sites/:id" element={<SiteDetail />} />
        <Route path="/assets" element={<AssetList />} />
        <Route path="/assets/new" element={<AssetNew />} />
        <Route path="/assets/:id" element={<AssetDetail />} />
        <Route path="/technicians" element={<TechnicianList />} />
        <Route path="/technicians/new" element={<TechnicianNew />} />
        <Route path="/technicians/:id" element={<TechnicianDetail />} />
        <Route path="/parts" element={<PartList />} />
        <Route path="/parts/new" element={<PartNew />} />
        <Route path="/parts/:id" element={<PartDetail />} />
        <Route path="/work_orders" element={<WorkOrderList />} />
        <Route path="/work_orders/new" element={<WorkOrderNew />} />
        <Route path="/work_orders/:id" element={<WorkOrderDetail />} />
        <Route path="/invoices" element={<InvoiceList />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/workflows" element={<WorkflowsIndex />} />
        <Route path="/workflows/schedule_work_order" element={<ScheduleWorkOrderWorkflowPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
