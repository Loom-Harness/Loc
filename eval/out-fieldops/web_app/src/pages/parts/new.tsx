// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { CreatePartRequest, useCreatePart } from "../../api/part";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, NumberInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function PartNew() {
  const navigate = useNavigate();
  const create = useCreatePart();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreatePartRequest>({
    resolver: zodResolver(CreatePartRequest),
    defaultValues: { sku: "", name: "", stockLevel: 0 },
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
    
            <TextInput label="Name" {...register("name")} data-testid="parts-new-input-name" error={errors.name?.message} />
    
            <Controller
              control={control}
              name="stockLevel"
              render={({ field, fieldState }) => (
                <NumberInput label="Stock Level" data-testid="parts-new-input-stockLevel" allowDecimal={false} value={field.value as number | "" | undefined} onChange={(v) => field.onChange(typeof v === "number" ? v : Number(v) || 0)} error={fieldState.error?.message} />
              )}
            />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="parts-new-submit">Create</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
