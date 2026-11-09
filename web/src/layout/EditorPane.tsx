import { Suspense, useEffect, useMemo } from "react";
import { Box, Center, Loader } from "@mantine/core";
import { constructBand } from "../build/correspondence";
import type { SourceHighlight } from "../editor/correspondence-decorations";
import { PlainEditor } from "../editor/PlainEditor";
import { LazyLoomEditor, preloadDesktopEditor } from "./lazy-panels";
import { SourceFilesTree } from "./SourceFilesTree";
import type { LayoutCtx } from "./ctx";
import { trackedCtx } from "./ctx-store";

interface Props {
  ctx: LayoutCtx;
  // Bordered = desktop, where the editor sits beside the right pane
  // and wants a right border as visual divider.  Mobile fullscreen
  // skips the border (the bottom-tab bar is the visual divider).
  border?: "right" | "bottom" | "none";
}

// Thin wrapper that owns the Monaco container's outer Box.  The
// LoomEditor itself fills 100% × 100% of this Box (its `automaticLayout`
// ResizeObserver needs a parent with definite size on first paint —
// flex + minHeight: 0 satisfies that on every shell).
//
// File explorer (`SourceFilesTree`):
//   - Desktop: a persistent left sidebar beside the editor — file
//     management is right-click → context menu (New / Rename / Delete).
//   - Mobile: a collapsible tree above the editor (closed by default so
//     the editor keeps the viewport); same context menu via long-press,
//     plus a header "+" and per-row delete for touch.
function EditorPaneView({ ctx, border = "none" }: Props): JSX.Element | null {
  const {
    lspClient,
    initialSource,
    exampleId,
    onSourceChange,
    onDiagnosticsChange,
    isDesktop,
    editorHandleRef,
    activeSourcePath,
    sourceEpoch,
    setActiveSourcePath,
    createSourceFile,
    deleteSourceFile,
    renameSourceFile,
    deleteSourceFolder,
    emptySourceFolders,
    createEmptySourceFolder,
    sourcesWritable,
    sourcesReadOnlyReason,
    sourceError,
    clearSourceError,
    workspace,
    viewMode,
  } = ctx;
  // Warm the editor chunk the moment a desktop pane exists, rather than when
  // the language client finally resolves — the two would otherwise serialize.
  useEffect(() => {
    if (isDesktop) preloadDesktopEditor();
  }, [isDesktop]);

  // Correspondence tinting for the SOURCE editor (M-T8.20 slice 3): the
  // standing colour-map bands, plus the transient flash of the `.ddd` span a
  // hovered generated line came from.  The flash is appended last so it wins
  // over the band it sits inside.
  const { colourMap, sourceBands: bands, reverseSpan } = ctx;
  const sourceHighlights = useMemo<SourceHighlight[]>(() => {
    const out: SourceHighlight[] = colourMap
      ? bands.map((b) => ({
          startLine: b.startLine,
          endLine: b.endLine,
          band: constructBand(b.construct),
          kind: "band" as const,
        }))
      : [];
    if (reverseSpan?.startLine !== undefined && reverseSpan.endLine !== undefined) {
      out.push({
        startLine: reverseSpan.startLine,
        endLine: reverseSpan.endLine,
        kind: "flash",
      });
    }
    return out;
  }, [colourMap, bands, reverseSpan]);

  // Desktop wants the full editor and therefore the language client; mobile
  // has neither, and `lspClient` is `null` there by construction (App.tsx
  // never constructs one).  A missing client on DESKTOP means the LSP is
  // still coming up — render nothing rather than an editor with no model.
  if (isDesktop && !lspClient) return null;

  // Mobile only: a collapsible source-file tree above the editor.  On
  // desktop the single file explorer lives in the left Explorer panel
  // (DesktopShell), so the editor pane is just the editor — no second
  // tree of the same files.
  // `ctx.sourceFiles` is read only on this branch: it changes on every
  // keystroke, and on desktop this pane has no tree to show it in.
  const explorer = isDesktop ? null : (
    <SourceFilesTree
      variant="accordion"
      files={ctx.sourceFiles}
      activePath={activeSourcePath}
      onSelect={setActiveSourcePath}
      onCreate={createSourceFile}
      onDelete={deleteSourceFile}
      onRename={renameSourceFile}
      emptyFolders={emptySourceFolders}
      onCreateFolder={createEmptySourceFolder}
      onDeleteFolder={deleteSourceFolder}
      writable={sourcesWritable}
      readOnlyReason={sourcesReadOnlyReason}
      error={sourceError}
      onDismissError={clearSourceError}
    />
  );

  // Remount on a DOCUMENT change so the editor reseeds from `initialSource`:
  // the active workspace (switch), whether its content has finished loading,
  // the last-imported example, and the active file path.
  //
  // `sourceEpoch` (the active file's content replaced under the same path — a
  // history restore, another tab's write) is deliberately NOT in Monaco's key:
  // a remount blanks the pane and resets scroll and caret, and the epoch can
  // move while the user is working in the editor.  `LoomEditor` reseeds in
  // place on `contentEpoch` instead.  `PlainEditor` has no in-place reseed, so
  // the mobile key keeps the epoch.
  const documentKey = `${workspace.activeId}:${workspace.loaded ? 1 : 0}:${exampleId}:${activeSourcePath}`;

  const editor = (
    <Box style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
      {isDesktop && lspClient ? (
        <Suspense
          fallback={
            <Center h="100%">
              <Loader size="sm" />
            </Center>
          }
        >
          <LazyLoomEditor
            key={documentKey}
            contentEpoch={sourceEpoch}
            client={lspClient}
            initialValue={initialSource}
            isMobile={false}
            handleRef={editorHandleRef}
            onChange={(v) => onSourceChange(v, "editor")}
            onDiagnosticsChange={onDiagnosticsChange}
            activePath={activeSourcePath}
            readOnly={viewMode}
            // Sticky on leave: the correspondence has to survive the mouse
            // travelling to the Explorer or the open generated file, which is
            // the whole point of it (godbolt keeps its mapping while you read
            // the output pane).  The editor still reports `null` honestly;
            // this is where the decision to ignore it lives.
            onHoverLine={(line) => {
              if (line !== null) ctx.setCorrespondenceLine(line);
            }}
            highlights={sourceHighlights}
          />
        </Suspense>
      ) : (
        // Mobile: a textarea, no Monaco, no language client.  Diagnostics on
        // this surface come from `generate` (the build worker already computes
        // them) rather than from a live LSP — see M-T8.15.
        <PlainEditor
          key={`${documentKey}:${sourceEpoch}`}
          initialValue={initialSource}
          handleRef={editorHandleRef}
          onChange={(v) => onSourceChange(v, "editor")}
          readOnly={viewMode}
        />
      )}
    </Box>
  );

  return (
    <Box
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        // Mobile stacks the accordion explorer above the editor; desktop
        // has no in-pane explorer (it's the left panel), so this is just
        // the editor.
        flexDirection: "column",
        borderRight: border === "right" ? "1px solid var(--loom-border)" : undefined,
        borderBottom: border === "bottom" ? "1px solid var(--loom-border)" : undefined,
      }}
    >
      {explorer}
      {editor}
    </Box>
  );
}

export const EditorPane = trackedCtx("EditorPane", EditorPaneView);
