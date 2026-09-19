"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { AssetIcon } from "./asset-icon";
export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  meta?: string;
  disabled?: boolean;
};
export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  searchable = false,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 280,
    maxHeight: 340,
  });
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) =>
    `${option.label} ${option.description ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  function close(restore = false) {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }
  function choose(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    close(true);
  }
  function positionMenu() {
    const rect = trigger.current!.getBoundingClientRect(),
      width = Math.min(Math.max(rect.width, 280), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 16,
      above = rect.top - 16;
    const height = Math.min(
      340,
      options.length * 58 + (searchable ? 104 : 42),
      Math.max(120, below >= 220 || below >= above ? below : above),
    );
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top:
        below >= 220 || below >= above
          ? rect.bottom + 6
          : Math.max(12, rect.top - height - 6),
      width,
      maxHeight: height,
    });
  }
  function show() {
    if (disabled) return;
    positionMenu();
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    if (disabled) {
      setOpen(false);
      return;
    }
    (searchable ? search.current : menu.current)?.focus({
      preventScroll: true,
    });
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const reposition = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !menu.current?.contains(event.target)
      )
        positionMenu();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, disabled, searchable]);
  useEffect(() => {
    if (open) {
      const option = document.getElementById(`${id}-option-${active}`);
      const list = option?.parentElement;
      if (option && list) {
        const top = option.offsetTop - list.offsetTop;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + option.offsetHeight > list.scrollTop + list.clientHeight)
          list.scrollTop = top + option.offsetHeight - list.clientHeight;
      }
      if (!searchable) option?.focus({ preventScroll: true });
    }
  }, [active, id, open, searchable]);
  function keys(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!filtered.length) return;
      const step = event.key === "ArrowUp" ? -1 : 1;
      let next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? filtered.length - 1
            : (active + step + filtered.length) % filtered.length;
      for (let i = 0; i < filtered.length && filtered[next]?.disabled; i++)
        next = (next + step + filtered.length) % filtered.length;
      setActive(next);
    } else if (event.key === "Enter" || (event.key === " " && !searchable)) {
      event.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    }
  }
  return (
    <div className="lp-custom-select">
      <button
        ref={trigger}
        type="button"
        className="lp-select-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            show();
          }
        }}
      >
        <span className="lp-select-value">
          <AssetIcon symbol={value} />
          {selected?.label ?? value}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="lp-select-menu"
            style={position}
            tabIndex={-1}
            onKeyDown={keys}
          >
            <div className="lp-select-title">{label}</div>
            {searchable && (
              <div className="lp-select-search">
                <Search size={15} aria-hidden="true" />
                <input
                  ref={search}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  placeholder="Search assets…"
                  aria-label={`Search ${label.toLowerCase()}`}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={`${id}-list`}
                  aria-activedescendant={
                    filtered[active] ? `${id}-option-${active}` : undefined
                  }
                />
              </div>
            )}
            <div
              id={`${id}-list`}
              role="listbox"
              aria-label={label}
              aria-activedescendant={
                !searchable && filtered[active]
                  ? `${id}-option-${active}`
                  : undefined
              }
              className="lp-select-options"
            >
              {filtered.map((option, index) => (
                <button
                  type="button"
                  role="option"
                  id={`${id}-option-${index}`}
                  tabIndex={-1}
                  key={option.value}
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  className={index === active ? "is-active" : ""}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  <AssetIcon symbol={option.value} />
                  <span className="lp-select-option-copy">
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                  </span>
                  {option.meta && (
                    <span className="lp-select-meta">{option.meta}</span>
                  )}
                  {option.value === value && (
                    <Check size={15} aria-hidden="true" />
                  )}
                </button>
              ))}
              {!filtered.length && (
                <p className="lp-select-empty" role="status">
                  No matching assets.
                </p>
              )}
            </div>
          </div>,
          trigger.current!.closest("dialog") ??
            trigger.current!.closest(".launchpad")!,
        )}
    </div>
  );
}
