import { CATEGORY_OPTIONS } from "../lib/categories";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";

export function CategoryPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(cat: string) {
    if (value.includes(cat)) onChange(value.filter((c) => c !== cat));
    else onChange([...value, cat]);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {CATEGORY_OPTIONS.map((cat) => {
        const active = value.includes(cat);
        return (
          <button
            key={cat}
            type="button"
            onClick={() => toggle(cat)}
            className="focus-visible:outline-none"
          >
            <Badge
              variant={active ? "default" : "outline"}
              className={cn("cursor-pointer", !active && "text-muted-foreground")}
            >
              {cat}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
