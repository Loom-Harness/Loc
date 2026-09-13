// Auto-generated.  Do not edit by hand.
import { useNavigate, Link as RouterLink } from "react-router";
import { CreateOrganizationRequest, useCreateOrganization } from "../../api/organization";
import { t } from "../../i18n";
import { applyServerErrors } from "../../lib/apply-server-errors";
import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Breadcrumbs, Button, Card, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useForm } from "react-hook-form";

export default function OrganizationNew() {
  const navigate = useNavigate();
  const create = useCreateOrganization();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<CreateOrganizationRequest>({
    resolver: zodResolver(CreateOrganizationRequest),
    defaultValues: { name: "" },
  });
  return (
    <Stack gap="md" data-testid="organizations-new-page">
      <Breadcrumbs>
        <Anchor component={RouterLink} to="/">{t("page.New.anchor.n0mxf2", "Home")}</Anchor>
        <Anchor component={RouterLink} to="/organizations">{t("page.New.anchor.1jburf", "Organizations")}</Anchor>
        <Text>{t("page.New.text.2ludo1", "New")}</Text>
      </Breadcrumbs>
      <Title order={2}>{t("page.New.heading.or2moo", "Create organization")}</Title>
      <Card withBorder padding="md">
        <form onSubmit={handleSubmit(async (vals) => {
                  try {
                    const out = await create.mutateAsync(vals);
                    notifications.show({ color: "green", message: "Organization created" });
                    navigate(`/organizations/${out.id}`);
                  } catch (e) {
                    const outcome = applyServerErrors({ error: e, setError, fieldMap: {} as const });
                    if (outcome.kind === "global") {
                      notifications.show({ color: "red", message: outcome.title });
                    } else if (outcome.kind === "unhandled") {
                      notifications.show({ color: "red", message: (e as Error).message });
                    }
                  }
                })} data-testid="organizations-new">
          <Stack gap="md">
            <TextInput label="Name" {...register("name")} data-testid="organizations-new-input-name" error={errors.name?.message} />
    
            <Group justify="flex-end" gap="xs" mt="md">
              <Button type="submit" loading={ create.isPending } data-testid="organizations-new-submit">Create</Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
//# sourceMappingURL=new.tsx.map
