// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import { useNavigate, Link as RouterLink } from "react-router";
import { CreateTechnicianRequest, type CreateTechnicianFormState, useCreateTechnician } from "../../api/technician";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Controller, useForm } from "react-hook-form";

export default function TechnicianNew() {
  const navigate = useNavigate();
  const create = useCreateTechnician();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<CreateTechnicianFormState, unknown, CreateTechnicianRequest>({
    resolver: zodResolver(CreateTechnicianRequest),
    defaultValues: { userId: "", fullName: "", skills: [], costRate: new Decimal("0") },
  });
  return (
    <Stack gap="md" data-testid="technicians-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/technicians">{t("page.New.anchor.26rebs", "Technicians")}</Anchor>
        <Text>{t("page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.New.heading.4bnw1x", "Create technician")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Technician created" });
                    navigate(`/technicians/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="technicians-new">
          <Stack gap="md">
            <TextInput label="User Id" {...register("userId")} data-testid="technicians-new-input-userId" error={errors.userId?.message} />
    
            <TextInput label="Full Name" {...register("fullName")} data-testid="technicians-new-input-fullName" error={errors.fullName?.message} />
    
            <TextInput label="Skills" {...register("skills")} data-testid="technicians-new-input-skills" placeholder={t("pack.mantine.arrayUnsupported.m0hiqj", "(arrays not yet supported in forms)")} disabled error={errors.skills?.message} />
    
            <Controller
              control={control}
              name="costRate"
              render={({ field, fieldState }) => (
                <TextInput label="Cost Rate" data-testid="technicians-new-input-costRate" value={field.value instanceof Decimal ? field.value.toString() : String(field.value ?? "0")} onChange={(e) => { try { field.onChange(new Decimal(e.currentTarget.value || "0")); } catch { field.onChange(new Decimal("0")); } }} inputMode="decimal" error={fieldState.error?.message} />
              )}
            />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="technicians-new-submit">Create</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
//# sourceMappingURL=new.tsx.map
