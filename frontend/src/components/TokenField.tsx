type TokenFieldProps = {
  label: string;

  token:
    | "Token 0"
    | "Token 1"
    | "LP";

  value: string;

  onChange: (
    value: string
  ) => void;

  balance?: string;
};

export function TokenField({
  label,
  token,
  value,
  onChange,
  balance = "—",
}: TokenFieldProps) {
  function handleInput(
    value: string
  ) {
    const valid =
      value === "" ||
      /^\d*\.?\d*$/.test(
        value
      );

    if (valid) {
      onChange(value);
    }
  }

  return (
    <div className="token-field">
      <div className="token-field-header">
        <span>
          {label}
        </span>

        <span>
          Balance: {balance}
        </span>
      </div>

      <div className="token-field-body">
        <input
          value={value}
          onChange={(event) =>
            handleInput(
              event.target.value
            )
          }
          placeholder="0.00"
          inputMode="decimal"
        />

        <div className="token-pill">
          <div className="token-symbol">
            {token[0]}
          </div>

          {token}
        </div>
      </div>
    </div>
  );
}