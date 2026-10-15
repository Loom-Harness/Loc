// Auto-generated.
import { Routes, Route, Link as RouterLink, useLocation, Outlet } from "react-router";
import { AppShell, Burger, Group, Title, NavLink, Anchor, Alert, Button, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useSession } from "./auth/AuthGate";
import { t } from "./i18n";
import Home from "./pages/home";
import CustomerList from "./pages/customers/list";
import CustomerNew from "./pages/customers/new";
import CustomerDetail from "./pages/customers/detail";
import AccountList from "./pages/accounts/list";
import AccountDetail from "./pages/accounts/detail";
import TransferList from "./pages/transfers/list";
import TransferDetail from "./pages/transfers/detail";
import InterestRunList from "./pages/interest_runs/list";
import InterestRunDetail from "./pages/interest_runs/detail";
import WorkflowsIndex from "./pages/workflows/index";
import ApproveTransferWorkflowPage from "./pages/workflows/approve_transfer";
import OpenAccountWorkflowPage from "./pages/workflows/open_account";
import RequestLargeTransferWorkflowPage from "./pages/workflows/request_large_transfer";
import TransferWorkflowPage from "./pages/workflows/transfer";
import MonthlyInterestInstancesList from "./pages/workflows/monthly_interest/instances";
import MonthlyInterestInstanceDetail from "./pages/workflows/monthly_interest/instance_detail";

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
  const currentUser = useSession().user as Record<string, any>;
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
                <Title order={4} style={{ letterSpacing: "-0.01em" }}>North Bank</Title>
              </Group>
            </Anchor>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md" aria-label={t("chrome.primaryNav", "Primary navigation")}>
        <Stack gap={4} data-testid="nav-sidebar">
          <div className="loom-nav-section">Aggregates</div>
          {(currentUser.role === "teller" || currentUser.role === "compliance") ? <NavLink component={RouterLink} to="/customers" label="Customers" active={isActive("/customers")} data-testid="nav-customers" /> : null}
          {(currentUser.role === "teller" || currentUser.role === "compliance") ? <NavLink component={RouterLink} to="/accounts" label="Accounts" active={isActive("/accounts")} data-testid="nav-accounts" /> : null}
          {(currentUser.role === "teller" || currentUser.role === "compliance") ? <NavLink component={RouterLink} to="/transfers" label="Transfers" active={isActive("/transfers")} data-testid="nav-transfers" /> : null}
          {(currentUser.role === "compliance") ? <NavLink component={RouterLink} to="/interest_runs" label="Interest Runs" active={isActive("/interest_runs")} data-testid="nav-interest_runs" /> : null}
          <div className="loom-nav-section">Workflows</div>
          <NavLink component={RouterLink} to="/workflows" label="All workflows" active={isActive("/workflows", { exact: true })} data-testid="nav-workflows" />
          <NavLink component={RouterLink} to="/workflows/approve_transfer" label="Approve Transfer" active={isActive("/workflows/approve_transfer")} data-testid="nav-workflow-approve_transfer" />
          <NavLink component={RouterLink} to="/workflows/open_account" label="Open Account" active={isActive("/workflows/open_account")} data-testid="nav-workflow-open_account" />
          <NavLink component={RouterLink} to="/workflows/request_large_transfer" label="Request Large Transfer" active={isActive("/workflows/request_large_transfer")} data-testid="nav-workflow-request_large_transfer" />
          <NavLink component={RouterLink} to="/workflows/transfer" label="Transfer" active={isActive("/workflows/transfer")} data-testid="nav-workflow-transfer" />
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
        <Route path="/customers" element={<CustomerList />} />
        <Route path="/customers/new" element={<CustomerNew />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/accounts" element={<AccountList />} />
        <Route path="/accounts/:id" element={<AccountDetail />} />
        <Route path="/transfers" element={<TransferList />} />
        <Route path="/transfers/:id" element={<TransferDetail />} />
        <Route path="/interest_runs" element={<InterestRunList />} />
        <Route path="/interest_runs/:id" element={<InterestRunDetail />} />
        <Route path="/workflows" element={<WorkflowsIndex />} />
        <Route path="/workflows/approve_transfer" element={<ApproveTransferWorkflowPage />} />
        <Route path="/workflows/open_account" element={<OpenAccountWorkflowPage />} />
        <Route path="/workflows/request_large_transfer" element={<RequestLargeTransferWorkflowPage />} />
        <Route path="/workflows/transfer" element={<TransferWorkflowPage />} />
        <Route path="/workflows/monthly_interest/instances" element={<MonthlyInterestInstancesList />} />
        <Route path="/workflows/monthly_interest/instances/:id" element={<MonthlyInterestInstanceDetail />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
