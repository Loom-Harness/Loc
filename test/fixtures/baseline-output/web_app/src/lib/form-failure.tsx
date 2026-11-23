// Auto-generated.  Do not edit by hand.

export function FormFailure({ error, testid }: { error?: { message?: string }; testid: string }) {
  if (!error?.message) return null;
  return (
    <p role="alert" data-testid={testid} style={{ color: "#c92a2a", margin: 0 }}>
      {error.message}
    </p>
  );
}
