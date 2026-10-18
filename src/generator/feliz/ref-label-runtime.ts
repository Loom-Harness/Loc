// The `LoomRefLabel` module in `App.fs` — the Feliz twin of the React per-cell
// reference label (`react/ref-label-runtime.ts` carries the rationale).
//
// Elmish has no query cache, so the module keeps its own: one in-flight
// promise per URL, reused for 30 s.  Every row referencing the same record
// shares that one request, and a record renamed elsewhere shows its new label
// on the next visit after the window rather than for the rest of the session.
// `fallback` (the id text) renders while loading, on error, and when the
// record has no non-empty `display`.

/** The call-site marker a rendered view carries when it needs the module. */
export const FELIZ_REF_LABEL_MARKER = "LoomRefLabel.view ";

export const FELIZ_REF_LABEL = `/// LoomRefLabel — labels a cross-aggregate reference link with the referenced
/// record's \`display\`, falling back to the id text.  A React child (the
/// hooks cannot run in a table-row loop), backed by a per-URL promise cache so
/// N rows referencing one record cost one request.
module LoomRefLabel =
  let private cache = System.Collections.Generic.Dictionary<string, float * JS.Promise<string option>>()

  let private load (url: string) : JS.Promise<string option> =
    async {
      let! (status, body) = Http.get url
      if status = 200 then
        match Decode.fromString (Decode.field "display" Decode.string) body with
        | Ok label when label <> "" -> return Some label
        | _ -> return None
      else
        return None
    }
    |> Async.StartAsPromise

  let private lookup (url: string) : JS.Promise<string option> =
    let now = JS.Constructors.Date.now ()
    match cache.TryGetValue url with
    | true, (at, pending) when now - at < 30000.0 -> pending
    | _ ->
      let pending = load url
      cache.[url] <- (now, pending)
      pending

  [<ReactComponent>]
  let Label (url: string) (fallback: ReactElement) =
    let loaded, setLoaded = React.useState<(string * string) option> None
    React.useEffect ((fun () ->
      let live = ref true
      (lookup url).\`\`then\`\`(fun label ->
        match label with
        | Some l when live.Value -> setLoaded (Some (url, l))
        | _ -> ()) |> ignore
      { new System.IDisposable with member _.Dispose () = live.Value <- false }), [| box url |])
    match loaded with
    | Some (u, l) when u = url -> Html.text l
    | _ -> fallback

  let view (path: string) (id: string) (fallback: ReactElement) : ReactElement =
    Label ("/api" + path + id) fallback`;
