import { Field } from "./Field.js";

export interface ItemForm {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
}

interface LineItemRowProps {
  index: number;
  item: ItemForm;
  errors: Record<string, string>;
  fieldId: (path: string) => string;
  onChange: (patch: Partial<ItemForm>) => void;
  onRemove: () => void;
}

export function LineItemRow({ index, item, errors, fieldId, onChange, onRemove }: LineItemRowProps) {
  const path = (field: string) => `items.${index}.${field}`;
  const props = (field: "description" | "quantity" | "unitPrice" | "unitCost") => ({
    id: fieldId(path(field)),
    value: item[field],
    error: errors[path(field)],
    onChange: (value: string) => onChange({ [field]: value }),
  });
  return (
    <fieldset className="line-item">
      <legend>Item {index + 1}</legend>
      <Field label="Description" {...props("description")} />
      <Field label="Quantity" inputMode="numeric" {...props("quantity")} />
      <Field label="Unit price (USD)" inputMode="decimal" {...props("unitPrice")} />
      <Field label="Unit cost (USD)" inputMode="decimal" {...props("unitCost")} />
      <button type="button" className="link-button" onClick={onRemove}>
        Remove item {index + 1}
      </button>
    </fieldset>
  );
}
