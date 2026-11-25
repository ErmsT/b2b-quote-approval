interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  multiline?: boolean;
  inputMode?: "decimal" | "numeric";
}

/** Labelled text input with its validation message linked through aria-describedby. */
export function Field({ id, label, value, onChange, error, multiline, inputMode }: FieldProps) {
  const errorId = `${id}-error`;
  const a11y = {
    id,
    value,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...a11y} rows={2} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...a11y} type="text" inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
