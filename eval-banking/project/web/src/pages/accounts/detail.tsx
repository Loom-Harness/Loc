// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import { useParams, Link as RouterLink } from "react-router";
import { AccrueInterestAccountRequest, CloseAccountRequest, CreditForTransferAccountRequest, DebitForTransferAccountRequest, DepositAccountRequest, FreezeAccountRequest, UnfreezeAccountRequest, WithdrawAccountRequest, type CreditForTransferAccountFormState, type DebitForTransferAccountFormState, type DepositAccountFormState, type WithdrawAccountFormState, useAccrueInterestAccount, useCloseAccount, useCreditForTransferAccount, useDebitForTransferAccount, useDepositAccount, useFreezeAccount, useUnfreezeAccount, useWithdrawAccount } from "../../api/account";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { DateTimeValue, IdValue, KeyValueRow, MoneyValue } from "../../lib/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Anchor, Badge, Breadcrumbs, Button, Card, Group, Skeleton, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";
import { useAccountById } from "../../api/account";
function openDepositModal(mut: ReturnType<typeof useDepositAccount>): void {
  modals.open({
    title: t("page.Detail.modalTitle.5lz1at", "Deposit"),
    children: <DepositForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function DepositForm({ mut, onClose }: { mut: ReturnType<typeof useDepositAccount>; onClose: () => void }) {
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<DepositAccountFormState, unknown, DepositAccountRequest>({
    resolver: zodResolver(DepositAccountRequest),
    defaultValues: { amount: new Decimal("0"), memo: "" },
  });
  return (
    <form
      data-testid="accounts-op-deposit-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Deposit" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <Controller
          control={control}
          name="amount"
          render={({ field, fieldState }) => (
            <TextInput label="Amount" data-testid="accounts-op-deposit-input-amount" value={field.value instanceof Decimal ? field.value.toString() : String(field.value ?? "0")} onChange={(e) => { try { field.onChange(new Decimal(e.currentTarget.value || "0")); } catch { field.onChange(new Decimal("0")); } }} inputMode="decimal" error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Memo" {...register("memo")} data-testid="accounts-op-deposit-input-memo" error={errors.memo?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="accounts-op-deposit-submit">Deposit</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openWithdrawModal(mut: ReturnType<typeof useWithdrawAccount>): void {
  modals.open({
    title: t("page.Detail.modalTitle.88y37b", "Withdraw"),
    children: <WithdrawForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function WithdrawForm({ mut, onClose }: { mut: ReturnType<typeof useWithdrawAccount>; onClose: () => void }) {
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<WithdrawAccountFormState, unknown, WithdrawAccountRequest>({
    resolver: zodResolver(WithdrawAccountRequest),
    defaultValues: { amount: new Decimal("0"), memo: "" },
  });
  return (
    <form
      data-testid="accounts-op-withdraw-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Withdraw" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <Controller
          control={control}
          name="amount"
          render={({ field, fieldState }) => (
            <TextInput label="Amount" data-testid="accounts-op-withdraw-input-amount" value={field.value instanceof Decimal ? field.value.toString() : String(field.value ?? "0")} onChange={(e) => { try { field.onChange(new Decimal(e.currentTarget.value || "0")); } catch { field.onChange(new Decimal("0")); } }} inputMode="decimal" error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Memo" {...register("memo")} data-testid="accounts-op-withdraw-input-memo" error={errors.memo?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="accounts-op-withdraw-submit">Withdraw</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openDebitForTransferModal(mut: ReturnType<typeof useDebitForTransferAccount>): void {
  modals.open({
    title: t("page.Detail.modalTitle.kr80vh", "Debit For Transfer"),
    children: <DebitForTransferForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function DebitForTransferForm({ mut, onClose }: { mut: ReturnType<typeof useDebitForTransferAccount>; onClose: () => void }) {
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<DebitForTransferAccountFormState, unknown, DebitForTransferAccountRequest>({
    resolver: zodResolver(DebitForTransferAccountRequest),
    defaultValues: { amount: new Decimal("0"), ref: "" },
  });
  return (
    <form
      data-testid="accounts-op-debitForTransfer-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Debit For Transfer" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <Controller
          control={control}
          name="amount"
          render={({ field, fieldState }) => (
            <TextInput label="Amount" data-testid="accounts-op-debitForTransfer-input-amount" value={field.value instanceof Decimal ? field.value.toString() : String(field.value ?? "0")} onChange={(e) => { try { field.onChange(new Decimal(e.currentTarget.value || "0")); } catch { field.onChange(new Decimal("0")); } }} inputMode="decimal" error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Ref" {...register("ref")} data-testid="accounts-op-debitForTransfer-input-ref" error={errors.ref?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="accounts-op-debitForTransfer-submit">Debit For Transfer</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openCreditForTransferModal(mut: ReturnType<typeof useCreditForTransferAccount>): void {
  modals.open({
    title: t("page.Detail.modalTitle.zgrgpm", "Credit For Transfer"),
    children: <CreditForTransferForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function CreditForTransferForm({ mut, onClose }: { mut: ReturnType<typeof useCreditForTransferAccount>; onClose: () => void }) {
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreditForTransferAccountFormState, unknown, CreditForTransferAccountRequest>({
    resolver: zodResolver(CreditForTransferAccountRequest),
    defaultValues: { amount: new Decimal("0"), ref: "" },
  });
  return (
    <form
      data-testid="accounts-op-creditForTransfer-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Credit For Transfer" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <Controller
          control={control}
          name="amount"
          render={({ field, fieldState }) => (
            <TextInput label="Amount" data-testid="accounts-op-creditForTransfer-input-amount" value={field.value instanceof Decimal ? field.value.toString() : String(field.value ?? "0")} onChange={(e) => { try { field.onChange(new Decimal(e.currentTarget.value || "0")); } catch { field.onChange(new Decimal("0")); } }} inputMode="decimal" error={fieldState.error?.message} />
          )}
        />

        <TextInput label="Ref" {...register("ref")} data-testid="accounts-op-creditForTransfer-input-ref" error={errors.ref?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="accounts-op-creditForTransfer-submit">Credit For Transfer</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openAccrueInterestModal(mut: ReturnType<typeof useAccrueInterestAccount>): void {
  modals.open({
    title: t("page.Detail.modalTitle.nro7lk", "Accrue Interest"),
    children: <AccrueInterestForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function AccrueInterestForm({ mut, onClose }: { mut: ReturnType<typeof useAccrueInterestAccount>; onClose: () => void }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<AccrueInterestAccountRequest>({
    resolver: zodResolver(AccrueInterestAccountRequest),
    defaultValues: { asOf: "" },
  });
  return (
    <form
      data-testid="accounts-op-accrueInterest-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Accrue Interest" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <TextInput label="As Of" {...register("asOf")} data-testid="accounts-op-accrueInterest-input-asOf" type="datetime-local" error={errors.asOf?.message} />

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="accounts-op-accrueInterest-submit">Accrue Interest</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openFreezeModal(mut: ReturnType<typeof useFreezeAccount>): void {
  modals.open({
    title: t("page.Detail.modalTitle.28icoy", "Freeze"),
    children: <FreezeForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function FreezeForm({ mut, onClose }: { mut: ReturnType<typeof useFreezeAccount>; onClose: () => void }) {
  const { handleSubmit, setError } = useForm<FreezeAccountRequest>({
    resolver: zodResolver(FreezeAccountRequest),
    defaultValues: {  },
  });
  return (
    <form
      data-testid="accounts-op-freeze-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Freeze" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <Text c="dimmed">{t("pack.mantine.noParameters.usdpad", "This operation has no parameters.")}</Text>
        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="accounts-op-freeze-submit">Freeze</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openUnfreezeModal(mut: ReturnType<typeof useUnfreezeAccount>): void {
  modals.open({
    title: t("page.Detail.modalTitle.tzdgtd", "Unfreeze"),
    children: <UnfreezeForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function UnfreezeForm({ mut, onClose }: { mut: ReturnType<typeof useUnfreezeAccount>; onClose: () => void }) {
  const { handleSubmit, setError } = useForm<UnfreezeAccountRequest>({
    resolver: zodResolver(UnfreezeAccountRequest),
    defaultValues: {  },
  });
  return (
    <form
      data-testid="accounts-op-unfreeze-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Unfreeze" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <Text c="dimmed">{t("pack.mantine.noParameters.usdpad", "This operation has no parameters.")}</Text>
        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="accounts-op-unfreeze-submit">Unfreeze</Button>
        </Group>
      </Stack>
    </form>
  );
}
function openCloseModal(mut: ReturnType<typeof useCloseAccount>): void {
  modals.open({
    title: t("page.Detail.modalTitle.l0xxoj", "Close"),
    children: <CloseForm mut={mut} onClose={() => modals.closeAll()} />,
  });
}

function CloseForm({ mut, onClose }: { mut: ReturnType<typeof useCloseAccount>; onClose: () => void }) {
  const { handleSubmit, setError } = useForm<CloseAccountRequest>({
    resolver: zodResolver(CloseAccountRequest),
    defaultValues: {  },
  });
  return (
    <form
      data-testid="accounts-op-close-form"
      onSubmit={handleSubmit(async (vals) => {
        try {
          await mut.mutateAsync(vals);
          notifications.show({ color: "green", message: t("pack.mantine.operationSucceeded.tpnozz", "{operation} succeeded", { operation: "Close" }) });
          onClose();
        } catch (e) {
          const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
          if (outcome.kind === "global") {
            notifications.show({ color: "red", message: outcome.title });
          } else if (outcome.kind === "unhandled") {
            notifications.show({ color: "red", message: (e as Error).message });
          }
        }
      })}
    >
      <Stack>
        <Text c="dimmed">{t("pack.mantine.noParameters.usdpad", "This operation has no parameters.")}</Text>
        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={onClose}>{t("chrome.cancel", "Cancel")}</Button>
          <Button type="submit" loading={mut.isPending} data-testid="accounts-op-close-submit">Close</Button>
        </Group>
      </Stack>
    </form>
  );
}

export default function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const accountById = useAccountById(id);
  const deposit = useDepositAccount(id ?? "");
  const withdraw = useWithdrawAccount(id ?? "");
  const debitForTransfer = useDebitForTransferAccount(id ?? "");
  const creditForTransfer = useCreditForTransferAccount(id ?? "");
  const accrueInterest = useAccrueInterestAccount(id ?? "");
  const freeze = useFreezeAccount(id ?? "");
  const unfreeze = useUnfreezeAccount(id ?? "");
  const close = useCloseAccount(id ?? "");
  return (
    <Stack gap="md" data-testid="accounts-detail">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.Detail.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/accounts">{t("page.Detail.anchor.dpi1wd", "Accounts")}</Anchor>
        <Text>{t("page.Detail.text.ei31dg", "Detail")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.Detail.heading.5f6ptx", "Account detail")}</Title>
      <>
        { accountById.isLoading && (
          <Stack gap="xs" aria-hidden="true">
    { Array.from({ length: 3 }).map((_, i) => (
    <Skeleton key={i} height={ 28 } radius="sm" />
    )) }
    </Stack>
        ) }
        { accountById.isError && (
          <Alert color="red" variant="light">{t("page.Detail.alert.xnlvje", "Couldn't load account")}</Alert>
        ) }
        { !accountById.isLoading && !accountById.isError && !accountById.data && (
          <Alert color="yellow" variant="light">{t("page.Detail.alert.8ocep4", "No account matches that id.")}</Alert>
        ) }
        { accountById.data && (
          <Stack gap="md">
            <Card withBorder padding="md">
              <Stack gap="md">
                <KeyValueRow label={t("page.Detail.keyValue.r616tc", "Number")} data-testid="accounts-detail-number"><Text>{accountById.data.number}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.71lv90", "Owner")} data-testid="accounts-detail-owner"><RouterLink to={`/customers/${ accountById.data.owner }`}><IdValue id={ accountById.data.owner } /></RouterLink></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.4dhof0", "Account Type")} data-testid="accounts-detail-accountType"><Badge tt="none">{ accountById.data.accountType }</Badge></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.5o3zh2", "Currency")} data-testid="accounts-detail-currency"><Text>{accountById.data.currency}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.03pd73", "Status")} data-testid="accounts-detail-status"><Badge tt="none">{ accountById.data.status }</Badge></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.kxxksr", "Balance")} data-testid="accounts-detail-balance"><MoneyValue value={ accountById.data.balance } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.1fn9kr", "Interest Rate")} data-testid="accounts-detail-interestRate"><Text>{accountById.data.interestRate}</Text></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.j7opvt", "Daily Limit")} data-testid="accounts-detail-dailyLimit"><MoneyValue value={ accountById.data.dailyLimit } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.3veuiy", "Withdrawn Today")} data-testid="accounts-detail-withdrawnToday"><MoneyValue value={ accountById.data.withdrawnToday } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.2y4zee", "Limit Day")} data-testid="accounts-detail-limitDay"><DateTimeValue iso={ accountById.data.limitDay } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.3jq1z9", "Opened At")} data-testid="accounts-detail-openedAt"><DateTimeValue iso={ accountById.data.openedAt } /></KeyValueRow>
                <KeyValueRow label={t("page.Detail.keyValue.q0zd4n", "Version")} data-testid="accounts-detail-version"><Text>{accountById.data.version}</Text></KeyValueRow>
              </Stack>
            </Card>
            <Card withBorder padding="md" data-testid="accounts-detail-entries">
              <Stack gap="md">
                <Title order={4}>{t("page.Detail.heading.p895zn", "Entries")}</Title>
                <div className="loom-table-scroll" style={{ width: "100%", overflowX: "auto" }}><Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("page.Detail.columnHeader.hqumoz", "Kind")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.a2ky21", "Amount")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.sxjcfp", "Balance After")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.o3ctk8", "At")}</Table.Th>
                      <Table.Th>{t("page.Detail.columnHeader.1vqxk3", "Memo")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    { accountById.data.entries.map((row, idx) => (
                      <Table.Tr key={ idx }>
                        <Table.Td><Badge tt="none">{ row.kind }</Badge></Table.Td>
                        <Table.Td><MoneyValue value={ row.amount } /></Table.Td>
                        <Table.Td><MoneyValue value={ row.balanceAfter } /></Table.Td>
                        <Table.Td><DateTimeValue iso={ row.at } /></Table.Td>
                        <Table.Td><Text>{row.memo}</Text></Table.Td>
                      </Table.Tr>
                    )) }
                  </Table.Tbody>
                </Table></div>
              </Stack>
            </Card>
            <Group gap="xs">
              <Button variant="filled" onClick={() => openDepositModal(deposit)} data-testid="accounts-op-deposit">{t("page.Detail.button.5lz1at", "Deposit")}</Button>
    
              <Button variant="light" onClick={() => openWithdrawModal(withdraw)} data-testid="accounts-op-withdraw">{t("page.Detail.button.88y37b", "Withdraw")}</Button>
    
              <Button variant="light" onClick={() => openDebitForTransferModal(debitForTransfer)} data-testid="accounts-op-debitForTransfer">{t("page.Detail.button.kr80vh", "Debit For Transfer")}</Button>
    
              <Button variant="light" onClick={() => openCreditForTransferModal(creditForTransfer)} data-testid="accounts-op-creditForTransfer">{t("page.Detail.button.zgrgpm", "Credit For Transfer")}</Button>
    
              <Button variant="light" onClick={() => openAccrueInterestModal(accrueInterest)} data-testid="accounts-op-accrueInterest">{t("page.Detail.button.nro7lk", "Accrue Interest")}</Button>
    
              <Button variant="light" onClick={() => openFreezeModal(freeze)} data-testid="accounts-op-freeze">{t("page.Detail.button.28icoy", "Freeze")}</Button>
    
              <Button variant="light" onClick={() => openUnfreezeModal(unfreeze)} data-testid="accounts-op-unfreeze">{t("page.Detail.button.tzdgtd", "Unfreeze")}</Button>
    
              <Button variant="light" onClick={() => openCloseModal(close)} data-testid="accounts-op-close">{t("page.Detail.button.l0xxoj", "Close")}</Button>
    
            </Group>
          </Stack>
        ) }
      </>
    </Stack>
  );
}
