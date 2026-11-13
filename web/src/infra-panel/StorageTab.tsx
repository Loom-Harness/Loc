// Object store / localDisk: the s3 buckets and the localDisk tree the infra
// worker holds for the deployables.  Browse by folder, view an object (text,
// image, or a hex dump), download it, upload a file, delete one — all through
// the `s3` and `disk` services, the same state the deployables read.

import {
  Anchor,
  Box,
  Breadcrumbs,
  Button,
  Group,
  Image,
  NavLink,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { InfraError, InfraHeader } from "./chrome";
import { declaredOf, type InfraTabProps } from "./types";
import { useInfra, useInfraAction, useInfraCall } from "./use-infra";

export const STORAGE_NOTES = [
  "Objects and files live in the browser (in memory, or OPFS for a persistent workspace), shared by every deployable of the system.",
  "S3 request signatures, ACLs, versioning, lifecycle rules and multipart uploads are not emulated; presigned URLs are served without checking expiry.",
  "Every localDisk storage shares one in-browser filesystem, keyed by path.",
];

/** A bucket, or the localDisk filesystem. */
interface Store {
  id: string;
  label: string;
  kind: "s3" | "disk";
  bucket?: string;
}

interface Entry {
  /** Key within the store (no leading slash). */
  key: string;
  size: number;
  contentType?: string;
}

interface S3Row {
  bucket: string;
  key: string;
  size: number;
  contentType: string;
}

const DISK: Store = { id: "disk", label: "localDisk", kind: "disk" };

export default function StorageTab({ env, active }: InfraTabProps): JSX.Element {
  const s3Declared = declaredOf(env, ["s3"]);
  const diskDeclared = declaredOf(env, ["localDisk"]).length > 0;
  const s3 = useInfra<S3Row[]>("s3", "list", {}, { enabled: active && s3Declared.length > 0 });
  const disk = useInfra<{ path: string; size: number }[]>("disk", "list", {}, { enabled: active && diskDeclared });

  const stores = useMemo<Store[]>(() => {
    const names = new Set<string>();
    for (const r of s3Declared) if (r.config.bucket) names.add(r.config.bucket);
    for (const o of s3.data ?? []) names.add(o.bucket);
    const out: Store[] = [...names].sort().map((b) => ({ id: `s3:${b}`, label: `s3://${b}`, kind: "s3", bucket: b }));
    if (diskDeclared) out.push(DISK);
    return out;
  }, [s3Declared, s3.data, diskDeclared]);

  const [storeId, setStoreId] = useState<string | null>(null);
  const store = stores.find((s) => s.id === storeId) ?? stores[0] ?? null;
  const [prefix, setPrefix] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);

  const entries = useMemo<Entry[]>(() => {
    if (!store) return [];
    if (store.kind === "s3") {
      return (s3.data ?? [])
        .filter((o) => o.bucket === store.bucket)
        .map((o) => ({ key: o.key, size: o.size, contentType: o.contentType }));
    }
    return (disk.data ?? []).map((f) => ({ key: f.path.replace(/^\//, ""), size: f.size }));
  }, [store, s3.data, disk.data]);

  // The immediate children of `prefix`: folders, then objects.
  const { folders, files } = useMemo(() => {
    const folders = new Set<string>();
    const files: Entry[] = [];
    for (const e of entries) {
      if (!e.key.startsWith(prefix)) continue;
      const rest = e.key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) folders.add(rest.slice(0, slash));
      else files.push(e);
    }
    return { folders: [...folders].sort(), files: files.sort((a, b) => a.key.localeCompare(b.key)) };
  }, [entries, prefix]);

  const pick = (s: Store): void => {
    setStoreId(s.id);
    setPrefix("");
    setViewing(null);
  };

  const crumbs = prefix.split("/").filter(Boolean);

  return (
    <Stack gap={0} style={{ flex: 1, minHeight: 0 }}>
      <InfraHeader title="Object store" notes={STORAGE_NOTES}>
        {store && <UploadButton store={store} prefix={prefix} />}
      </InfraHeader>
      <InfraError message={s3.error ?? disk.error} />
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          alignContent: "start",
        }}
      >
        <Stack gap={0} style={{ borderRight: "1px solid var(--loom-border)" }} data-testid="storage-stores">
          {stores.map((s) => (
            <NavLink
              key={s.id}
              label={s.label}
              active={s.id === store?.id}
              onClick={() => pick(s)}
              data-testid="storage-store"
              data-store={s.id}
              styles={{ label: { fontSize: 12 } }}
              py={4}
            />
          ))}
        </Stack>
        <Stack gap={0} style={{ minWidth: 0, gridColumn: "span 2" }}>
          {store && (
            <Breadcrumbs px="sm" py={4} separator="/" data-testid="storage-crumbs" style={{ fontSize: 12 }}>
              <Anchor component="button" size="xs" onClick={() => setPrefix("")}>
                {store.label}
              </Anchor>
              {crumbs.map((c, i) => (
                <Anchor component="button" key={`${i}:${c}`} size="xs" onClick={() => setPrefix(`${crumbs.slice(0, i + 1).join("/")}/`)}>
                  {c}
                </Anchor>
              ))}
            </Breadcrumbs>
          )}
          {folders.length === 0 && files.length === 0 ? (
            <Text size="xs" c="dimmed" px="sm" py={6} data-testid="storage-empty">
              {store ? "Nothing stored here yet." : "No bucket or disk yet."}
            </Text>
          ) : (
            <ScrollArea>
              <Table fz="xs" verticalSpacing={2} data-testid="storage-list">
                <Table.Tbody>
                  {folders.map((f) => (
                    <Table.Tr key={`d:${f}`} data-testid="storage-folder" data-name={f}>
                      <Table.Td colSpan={3}>
                        <Anchor component="button" size="xs" onClick={() => setPrefix(`${prefix}${f}/`)}>
                          {f}/
                        </Anchor>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {files.map((e) => (
                    <FileRow
                      key={e.key}
                      store={store as Store}
                      entry={e}
                      name={e.key.slice(prefix.length)}
                      onView={() => setViewing(e.key)}
                      onDeleted={() => viewing === e.key && setViewing(null)}
                    />
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
          {store && viewing && <ObjectView store={store} objectKey={viewing} onClose={() => setViewing(null)} />}
        </Stack>
      </Box>
    </Stack>
  );
}

// ---------------------------------------------------------------------

async function readObject(
  call: NonNullable<ReturnType<typeof useInfraCall>["call"]>,
  store: Store,
  key: string,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (store.kind === "s3") {
    return call<{ body: Uint8Array; contentType: string } | null>("s3", "get", { bucket: store.bucket, key });
  }
  const body = await call<Uint8Array | null>("disk", "read", { path: `/${key}` });
  return body ? { body, contentType: guessType(key) } : null;
}

function guessType(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  const known: Record<string, string> = {
    json: "application/json",
    txt: "text/plain",
    md: "text/markdown",
    html: "text/html",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  return known[ext] ?? "application/octet-stream";
}

function download(name: string, body: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([body as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.split("/").pop() || "object";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function FileRow({
  store,
  entry,
  name,
  onView,
  onDeleted,
}: {
  store: Store;
  entry: Entry;
  name: string;
  onView: () => void;
  onDeleted: () => void;
}): JSX.Element {
  const { call } = useInfraCall();
  const { run } = useInfraAction();
  const [error, setError] = useState<string | null>(null);
  return (
    <Table.Tr data-testid="storage-object" data-key={entry.key}>
      <Table.Td style={{ wordBreak: "break-all" }}>
        <Anchor component="button" size="xs" onClick={onView} data-testid="storage-object-name">
          {name}
        </Anchor>
        {error && (
          <Text size="xs" c="red">
            {error}
          </Text>
        )}
      </Table.Td>
      <Table.Td style={{ whiteSpace: "nowrap" }} data-testid="storage-object-size">
        {entry.size} B
      </Table.Td>
      <Table.Td style={{ whiteSpace: "nowrap" }}>
        <Group gap={2} wrap="nowrap" justify="flex-end">
          <Button
            size="compact-xs"
            variant="subtle"
            data-testid="storage-download"
            onClick={async () => {
              setError(null);
              try {
                const o = call ? await readObject(call, store, entry.key) : null;
                if (!o) throw new Error("Object is gone.");
                download(entry.key, o.body, o.contentType);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Download
          </Button>
          <Button
            size="compact-xs"
            variant="subtle"
            color="red"
            data-testid="storage-delete"
            onClick={() => {
              setError(null);
              const done =
                store.kind === "s3"
                  ? run("s3", "delete", { bucket: store.bucket, key: entry.key })
                  : run("disk", "rm", { path: `/${entry.key}` });
              done.then(onDeleted, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
            }}
          >
            Delete
          </Button>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

const PREVIEW_LIMIT = 256 * 1024;

function ObjectView({ store, objectKey, onClose }: { store: Store; objectKey: string; onClose: () => void }): JSX.Element {
  const { call, epoch } = useInfraCall();
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "gone" } | { kind: "error"; message: string } | { kind: "ok"; body: Uint8Array; type: string }
  >({ kind: "loading" });
  useEffect(() => {
    if (!call) return;
    let live = true;
    readObject(call, store, objectKey).then(
      (o) => live && setState(o ? { kind: "ok", body: o.body, type: o.contentType } : { kind: "gone" }),
      (e: unknown) => live && setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [call, store, objectKey, epoch]);

  return (
    <Stack gap={4} p="sm" style={{ borderTop: "1px solid var(--loom-border)" }} data-testid="storage-view">
      <Group justify="space-between" wrap="nowrap">
        <Text size="xs" fw={600} style={{ wordBreak: "break-all" }} data-testid="storage-view-key">
          {objectKey}
        </Text>
        <Button size="compact-xs" variant="subtle" onClick={onClose}>
          Close
        </Button>
      </Group>
      {state.kind === "loading" && <Text size="xs" c="dimmed">Loading…</Text>}
      {state.kind === "gone" && <Text size="xs" c="dimmed">This object no longer exists.</Text>}
      {state.kind === "error" && <Text size="xs" c="red">{state.message}</Text>}
      {state.kind === "ok" && <ObjectBody body={state.body} type={state.type} />}
    </Stack>
  );
}

function ObjectBody({ body, type }: { body: Uint8Array; type: string }): JSX.Element {
  const url = useMemo(() => (type.startsWith("image/") ? URL.createObjectURL(new Blob([body as Uint8Array<ArrayBuffer>], { type })) : null), [body, type]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const meta = (
    <Text size="xs" c="dimmed" data-testid="storage-view-meta">
      {type} · {body.byteLength} bytes
    </Text>
  );
  if (url) {
    return (
      <>
        {meta}
        <Image src={url} alt="" maw={360} fit="contain" />
      </>
    );
  }
  let text: string | null = null;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(0, PREVIEW_LIMIT));
  } catch {
    text = null;
  }
  const shown =
    text ??
    [...body.subarray(0, 512)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
      .replace(/((?:\S+ ){16})/g, "$1\n");
  return (
    <>
      {meta}
      <Box
        component="pre"
        m={0}
        p="xs"
        data-testid="storage-view-body"
        data-binary={text === null}
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 12,
          maxHeight: 320,
          overflow: "auto",
          border: "1px solid var(--loom-border)",
          borderRadius: 4,
        }}
      >
        {shown}
        {body.byteLength > (text === null ? 512 : PREVIEW_LIMIT) ? "\n…" : ""}
      </Box>
    </>
  );
}

function UploadButton({ store, prefix }: { store: Store; prefix: string }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const { run } = useInfraAction();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && (
        <Text size="xs" c="red" data-testid="storage-upload-error">
          {error}
        </Text>
      )}
      <input
        ref={input}
        type="file"
        hidden
        data-testid="storage-upload-input"
        onChange={async (ev) => {
          const file = ev.currentTarget.files?.[0];
          ev.currentTarget.value = "";
          if (!file) return;
          setError(null);
          try {
            const body = new Uint8Array(await file.arrayBuffer());
            const key = `${prefix}${file.name}`;
            if (store.kind === "s3") {
              await run("s3", "put", { bucket: store.bucket, key, body, contentType: file.type || guessType(key) });
            } else {
              await run("disk", "write", { path: `/${key}`, data: body });
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
      <Button size="compact-xs" variant="light" data-testid="storage-upload" onClick={() => input.current?.click()}>
        Upload
      </Button>
    </>
  );
}
