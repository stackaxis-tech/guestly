import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

type Opt = { value: string; label: ReactNode; text: string; disabled?: boolean };

function textOf(n: ReactNode): string {
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(n)) return textOf(n.props.children);
  return "";
}

function readOptions(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  const parse = (node: ReactNode) => {
    Children.toArray(node).forEach((c) => {
      if (!isValidElement(c)) return;
      if (c.type === Fragment || (typeof c.type === "symbol" && String(c.type).includes("react.fragment"))) {
        parse((c as ReactElement<{ children?: ReactNode }>).props.children);
        return;
      }
      const el = c as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
      const text = textOf(el.props.children);
      out.push({ value: String(el.props.value ?? text), label: el.props.children, text, disabled: el.props.disabled });
    });
  };
  parse(children);
  return out;
}

const setNativeValue = (el: HTMLSelectElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

type Props = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; placeholder?: string };

/**
 * Branded dropdown that is a drop-in replacement for <select>.
 * A hidden native <select> stays in the DOM as the source of truth, so
 * react-hook-form's register(), value/onChange, and form submission keep
 * working unchanged; the visible part is a button + listbox we can style.
 */
export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { className, invalid, children, id, disabled, placeholder = "Select…", "aria-describedby": describedBy, ...rest },
  ref,
) {
  const options = readOptions(children);
  const native = useRef<HTMLSelectElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [value, setValue] = useState<string>(String(rest.value ?? rest.defaultValue ?? ""));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean }>({ top: 0, left: 0, width: 0, up: false });
  const typed = useRef({ text: "", at: 0 });

  // Keep the visible value in sync with the native select, which forms may change without events (reset, values).
  useLayoutEffect(() => {
    const v = native.current?.value ?? "";
    if (v !== value) setValue(v);
  });

  const selected = options.find((o) => o.value === value);

  const place = useCallback(() => {
    const r = button.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 260 && r.top > below;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, width: r.width, up });
  }, []);

  const openMenu = () => {
    if (disabled) return;
    place();
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    setOpen(true);
  };

  const choose = (o: Opt) => {
    if (o.disabled || !native.current) return;
    setNativeValue(native.current, o.value);
    setValue(o.value);
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    // Scroll only the list (scrollIntoView would also scroll the page, which closes the menu).
    const ul = list.current;
    const li = ul?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !ul || !li) return;
    if (li.offsetTop < ul.scrollTop) ul.scrollTop = li.offsetTop - 4;
    else if (li.offsetTop + li.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = li.offsetTop + li.offsetHeight - ul.clientHeight + 4;
  }, [open, active]);

  const move = (dir: 1 | -1) => {
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        return;
      case "Home":
        e.preventDefault();
        setActive(0);
        return;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (options[active]) choose(options[active]);
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // don't close a surrounding sheet
        setOpen(false);
        return;
      case "Tab":
        setOpen(false);
        return;
    }
    // Type-ahead: jump to the first option starting with the typed letters.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const i = options.findIndex((o) => o.text.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  };

  const empty = !selected || selected.value === "";

  return (
    <div className={clsx("relative", className)}>
      <select
        {...rest}
        ref={(el) => {
          native.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      >
        {children}
      </select>
      <button
        ref={button}
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
        className={clsx(
          "flex h-10 w-full items-center gap-2 rounded-lg border bg-paper pr-2.5 pl-3 text-left text-[15px] transition-colors",
          "focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none disabled:cursor-not-allowed disabled:bg-sand disabled:text-muted",
          invalid ? "border-danger" : open ? "border-ink/40 ring-3 ring-ink/5" : "border-line hover:border-line-strong",
        )}
      >
        <span className={clsx("min-w-0 flex-1 truncate", empty ? "text-muted/80" : "text-ink")}>
          {empty ? (selected?.text && selected.text !== "—" ? selected.label : placeholder) : selected.label}
        </span>
        <ChevronDown className={clsx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          style={{
            position: "fixed",
            left: pos.left,
            width: Math.max(pos.width, 180),
            ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
          }}
          className="z-[1000] max-h-64 overflow-y-auto rounded-xl border border-line bg-paper p-1 shadow-[var(--shadow-pop)]"
        >
          {options.map((o, i) => {
            const isSel = o.value === value;
            return (
              <li
                key={o.value + i}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSel}
                aria-disabled={o.disabled || undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                className={clsx(
                  "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[15px]",
                  o.disabled && "cursor-not-allowed opacity-50",
                  i === active ? "bg-brand-50 text-brand-900" : "text-ink",
                  isSel && "font-semibold",
                )}
              >
                <span className={clsx("min-w-0 flex-1 truncate", o.value === "" && "text-muted")}>{o.value === "" && o.text === "—" ? "None" : o.label}</span>
                {isSel && <Check className="size-4 shrink-0 text-brand-700" aria-hidden />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
