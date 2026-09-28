// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import { useNavigate, Link as RouterLink } from "react-router";
import { CreatePartRequest, type CreatePartFormState, useCreatePart } from "../../api/part";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, NumberInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function PartNew() {
  const navigate = useNavigate();
  const create = useCreatePart();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreatePartFormState, unknown, CreatePartRequest>({
    resolver: zodResolver(CreatePartRequest),
    defaultValues: { sku: "", binCode: "", onHand: 0, unitPrice: new Decimal("0"), currency: "" },
  });
  return (
    <Stack gap="md" data-testid="parts-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/parts">{t("page.New.anchor.cegybp", "Parts")}</Anchor>
        <Text>{t("page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.New.heading.1wlsey", "Create part")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Part created" });
                    navigate(`/parts/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="parts-new">
          <Stack gap="md">
            <TextInput label="Sku" {...register("sku")} data-testid="parts-new-input-sku" error={errors.sku?.message} />
    
            <TextInput label="Bin Code" {...register("binCode")} data-testid="parts-new-input-binCode" error={errors.binCode?.message} />
    
            <Controller
              control={control}
              name="onHand"
              render={({ field, fieldState }) => (
                <NumberInput label="On Hand" data-testid="parts-new-input-onHand" allowDecimal={false} value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
              )}
            />
    
            <Controller
              control={control}
              name="unitPrice"
              render={({ field, fieldState }) => (
                <TextInput label="Unit Price" data-testid="parts-new-input-unitPrice" value={field.value instanceof Decimal ? field.value.toString() : String(field.value ?? "0")} onChange={(e) => { try { field.onChange(new Decimal(e.currentTarget.value || "0")); } catch { field.onChange(new Decimal("0")); } }} inputMode="decimal" error={fieldState.error?.message} />
              )}
            />
    
            <TextInput label="Currency" {...register("currency")} data-testid="parts-new-input-currency" error={errors.currency?.message} />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="parts-new-submit">Create</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
//# sourceMappingURL=new.tsx.map
