/**
 * WeChat Mini Program component runtime for browser preview.
 *
 * Maps WXML components to React equivalents with correct event shapes.
 * All event handlers receive a synthetic WeChat event: { type, detail, target, currentTarget }.
 * Input/change events carry detail.value matching the real wx runtime.
 */

import React, { useRef, useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function makeWxEvent(type: string, detail: Record<string, unknown>, el: EventTarget | null) {
  const dataset: Record<string, string> = {};
  if (el && el instanceof HTMLElement) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-wx-")) {
        const key = attr.name.slice(8).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        dataset[key] = attr.value;
      }
    }
  }
  return { type, timeStamp: Date.now(), detail, target: { dataset }, currentTarget: { dataset } };
}

function tapHandler(handler?: (e: unknown) => void) {
  if (!handler) return undefined;
  return (e: React.MouseEvent) => {
    e.stopPropagation();
    handler(makeWxEvent("tap", { x: e.clientX, y: e.clientY }, e.currentTarget));
  };
}

// ---------------------------------------------------------------------------
// Touch event adapter — matches WeChat event shape
// { touches, changedTouches, timeStamp, target, currentTarget }
// ---------------------------------------------------------------------------

function serializeTouches(list: React.TouchList): Array<Record<string, number>> {
  const out: Array<Record<string, number>> = [];
  for (let i = 0; i < list.length; i++) {
    const t = list.item(i);
    out.push({
      identifier: t.identifier,
      pageX: t.pageX, pageY: t.pageY,
      clientX: t.clientX, clientY: t.clientY,
    });
  }
  return out;
}

function touchHandler(type: string, handler?: (e: unknown) => void) {
  if (!handler) return undefined;
  return (e: React.TouchEvent) => {
    const base = makeWxEvent(type, {}, e.currentTarget);
    const wxEvent = {
      ...base,
      touches: serializeTouches(e.touches),
      changedTouches: serializeTouches(e.changedTouches),
    };
    handler(wxEvent);
  };
}

interface TouchBindings {
  bindtouchstart?: (e: unknown) => void;
  bindtouchmove?: (e: unknown) => void;
  bindtouchend?: (e: unknown) => void;
  bindtouchcancel?: (e: unknown) => void;
  bindlongpress?: (e: unknown) => void;
  catchtouchstart?: (e: unknown) => void;
  catchtouchmove?: (e: unknown) => void;
  catchtouchend?: (e: unknown) => void;
  catchtouchcancel?: (e: unknown) => void;
}

/**
 * Build React touch props from WeChat bindtouch/catchtouch handlers.
 * `bindlongpress` fires after 350ms of sustained touch with no movement.
 */
function useTouchProps(b: TouchBindings) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startHandler = b.bindtouchstart ?? b.catchtouchstart;
  const moveHandler = b.bindtouchmove ?? b.catchtouchmove;
  const endHandler = b.bindtouchend ?? b.catchtouchend;
  const cancelHandler = b.bindtouchcancel ?? b.catchtouchcancel;

  const clearLong = () => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } };

  const onTouchStart = (startHandler || b.bindlongpress) ? (e: React.TouchEvent) => {
    if (b.catchtouchstart) e.stopPropagation();
    if (startHandler) touchHandler("touchstart", startHandler)?.(e);
    if (b.bindlongpress) {
      clearLong();
      const base = makeWxEvent("longpress", {}, e.currentTarget);
      const serialized = { ...base, touches: serializeTouches(e.touches), changedTouches: serializeTouches(e.changedTouches) };
      longPressTimer.current = setTimeout(() => { b.bindlongpress?.(serialized); }, 350);
    }
  } : undefined;

  const onTouchMove = (moveHandler || b.bindlongpress) ? (e: React.TouchEvent) => {
    if (b.catchtouchmove) e.stopPropagation();
    if (b.bindlongpress) clearLong();
    if (moveHandler) touchHandler("touchmove", moveHandler)?.(e);
  } : undefined;

  const onTouchEnd = (endHandler || b.bindlongpress) ? (e: React.TouchEvent) => {
    if (b.catchtouchend) e.stopPropagation();
    if (b.bindlongpress) clearLong();
    if (endHandler) touchHandler("touchend", endHandler)?.(e);
  } : undefined;

  const onTouchCancel = (cancelHandler || b.bindlongpress) ? (e: React.TouchEvent) => {
    if (b.catchtouchcancel) e.stopPropagation();
    if (b.bindlongpress) clearLong();
    if (cancelHandler) touchHandler("touchcancel", cancelHandler)?.(e);
  } : undefined;

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}

/**
 * Pluck known touch/tap bindings off a WxBaseProps-ish bag. Used to keep these
 * keys out of `{...rest}` spreads that feed into real DOM elements (React warns
 * on unknown props like `bindtouchstart` hitting `<div>`).
 */
const WX_EVENT_KEYS = [
  "bindtap", "catchtap",
  "bindtouchstart", "bindtouchmove", "bindtouchend", "bindtouchcancel",
  "catchtouchstart", "catchtouchmove", "catchtouchend", "catchtouchcancel",
  "bindlongpress", "bindlongtap",
] as const;

function extractTouchBindings(props: Record<string, unknown>): TouchBindings {
  const out: TouchBindings = {};
  for (const k of WX_EVENT_KEYS) {
    const v = props[k];
    if (typeof v === "function") (out as Record<string, unknown>)[k] = v;
  }
  // bindlongtap is the legacy alias for bindlongpress
  if (!out.bindlongpress && typeof props.bindlongtap === "function") out.bindlongpress = props.bindlongtap as (e: unknown) => void;
  return out;
}

// ---------------------------------------------------------------------------
// Base props shared by all components
// ---------------------------------------------------------------------------

interface WxBaseProps {
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  bindtap?: (e: unknown) => void;
  catchtap?: (e: unknown) => void;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function View({ id, className, style, children, bindtap, catchtap, ...rest }: WxBaseProps) {
  const dataAttrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (k.startsWith("data-")) dataAttrs[k] = String(v ?? "");
  }
  const touch = useTouchProps(extractTouchBindings(rest));
  return (
    <div id={id} className={className} style={style} onClick={tapHandler(bindtap ?? catchtap)} {...touch} {...dataAttrs}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function Text({ id, className, style, children, bindtap, catchtap, ...rest }: WxBaseProps) {
  const dataAttrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (k.startsWith("data-")) dataAttrs[k] = String(v ?? "");
  }
  const touch = useTouchProps(extractTouchBindings(rest));
  return (
    <span id={id} className={className} style={style} onClick={tapHandler(bindtap ?? catchtap)} {...touch} {...dataAttrs}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

type ImageMode =
  | "scaleToFill" | "aspectFit" | "aspectFill" | "widthFix" | "heightFix"
  | "top" | "bottom" | "center" | "left" | "right"
  | "top left" | "top right" | "bottom left" | "bottom right";

const MODE_FIT: Record<ImageMode, string> = {
  scaleToFill: "fill", aspectFit: "contain", aspectFill: "cover",
  widthFix: "fill", heightFix: "fill",
  top: "none", bottom: "none", center: "none", left: "none", right: "none",
  "top left": "none", "top right": "none", "bottom left": "none", "bottom right": "none",
};

interface ImageProps extends WxBaseProps {
  src?: string;
  mode?: ImageMode;
}

export function Image({ id, className, style, src, mode = "scaleToFill", bindtap, catchtap, ...rest }: ImageProps) {
  const objectFit = MODE_FIT[mode] ?? "fill";
  const touch = useTouchProps(extractTouchBindings(rest));
  return (
    <img
      id={id}
      className={className}
      src={src}
      style={{ display: "block", width: "100%", height: "100%", objectFit: objectFit as React.CSSProperties["objectFit"], ...style }}
      onClick={tapHandler(bindtap ?? catchtap)}
      {...touch}
      alt=""
    />
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

interface ButtonProps extends WxBaseProps {
  type?: "primary" | "default" | "warn";
  disabled?: boolean;
  loading?: boolean;
}

export function Button({ id, className, style, children, bindtap, catchtap, type = "default", disabled, loading, ...rest }: ButtonProps) {
  const baseStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "0 32px", height: "44px", borderRadius: "4px",
    fontSize: "18px", fontWeight: 500, border: "none", cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    background: type === "primary" ? "#07c160" : type === "warn" ? "#e64340" : "#f5f5f5",
    color: type === "default" ? "#333" : "#fff",
    ...style,
  };
  const touch = useTouchProps(extractTouchBindings(rest));
  return (
    <button id={id} className={className} style={baseStyle} disabled={disabled} onClick={disabled ? undefined : tapHandler(bindtap ?? catchtap)} {...touch}>
      {loading && (
        <span style={{ marginRight: 6, display: "inline-block", width: 16, height: 16, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "wx-spin 0.8s linear infinite" }} />
      )}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface InputProps extends WxBaseProps {
  value?: string;
  placeholder?: string;
  type?: "text" | "number" | "idcard" | "digit" | "tel";
  password?: boolean;
  disabled?: boolean;
  maxlength?: number;
  bindinput?: (e: unknown) => void;
  bindchange?: (e: unknown) => void;
  bindfocus?: (e: unknown) => void;
  bindblur?: (e: unknown) => void;
  bindconfirm?: (e: unknown) => void;
}

export function Input({ id, className, style, value, placeholder, type = "text", password, disabled, maxlength, bindinput, bindchange, bindfocus, bindblur, bindconfirm }: InputProps) {
  const [localVal, setLocalVal] = useState(value ?? "");
  useEffect(() => { setLocalVal(value ?? ""); }, [value]);

  const htmlType = password ? "password" : type === "digit" || type === "number" ? "number" : type === "tel" ? "tel" : "text";

  return (
    <input
      id={id}
      className={className}
      style={{ display: "block", width: "100%", padding: "8px", border: "1px solid #ddd", borderRadius: "4px", fontSize: "14px", background: "#fff", ...style }}
      type={htmlType}
      value={localVal}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxlength}
      onChange={(e) => {
        setLocalVal(e.target.value);
        bindinput && bindinput(makeWxEvent("input", { value: e.target.value }, e.currentTarget));
      }}
      onBlur={(e) => {
        bindchange && bindchange(makeWxEvent("change", { value: e.target.value }, e.currentTarget));
        bindblur && bindblur(makeWxEvent("blur", { value: e.target.value }, e.currentTarget));
      }}
      onFocus={(e) => bindfocus && bindfocus(makeWxEvent("focus", { value: e.target.value }, e.currentTarget))}
      onKeyDown={(e) => {
        if (e.key === "Enter") bindconfirm && bindconfirm(makeWxEvent("confirm", { value: (e.target as HTMLInputElement).value }, e.currentTarget));
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Textarea
// ---------------------------------------------------------------------------

interface TextareaProps extends WxBaseProps {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  maxlength?: number;
  bindinput?: (e: unknown) => void;
  bindchange?: (e: unknown) => void;
  bindfocus?: (e: unknown) => void;
  bindblur?: (e: unknown) => void;
}

export function Textarea({ id, className, style, value, placeholder, disabled, maxlength, bindinput, bindchange, bindfocus, bindblur }: TextareaProps) {
  const [localVal, setLocalVal] = useState(value ?? "");
  useEffect(() => { setLocalVal(value ?? ""); }, [value]);
  return (
    <textarea
      id={id}
      className={className}
      style={{ display: "block", width: "100%", padding: "8px", border: "1px solid #ddd", borderRadius: "4px", fontSize: "14px", background: "#fff", resize: "none", ...style }}
      value={localVal}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxlength}
      onChange={(e) => {
        setLocalVal(e.target.value);
        bindinput && bindinput(makeWxEvent("input", { value: e.target.value }, e.currentTarget));
      }}
      onBlur={(e) => {
        bindchange && bindchange(makeWxEvent("change", { value: e.target.value }, e.currentTarget));
        bindblur && bindblur(makeWxEvent("blur", { value: e.target.value }, e.currentTarget));
      }}
      onFocus={(e) => bindfocus && bindfocus(makeWxEvent("focus", { value: e.target.value }, e.currentTarget))}
    />
  );
}

// ---------------------------------------------------------------------------
// ScrollView
// ---------------------------------------------------------------------------

interface ScrollViewProps extends WxBaseProps {
  scrollY?: boolean;
  scrollX?: boolean;
  bindscroll?: (e: unknown) => void;
  bindscrolltolower?: (e: unknown) => void;
  bindscrolltoupper?: (e: unknown) => void;
}

export function ScrollView({ id, className, style, children, scrollY, scrollX, bindscroll, bindscrolltolower, bindscrolltoupper, bindtap, catchtap, ...rest }: ScrollViewProps) {
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    bindscroll && bindscroll(makeWxEvent("scroll", { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth }, el));
    if (bindscrolltolower && el.scrollTop + el.clientHeight >= el.scrollHeight - 10) {
      bindscrolltolower(makeWxEvent("scrolltolower", {}, el));
    }
    if (bindscrolltoupper && el.scrollTop <= 10) {
      bindscrolltoupper(makeWxEvent("scrolltoupper", {}, el));
    }
  }, [bindscroll, bindscrolltolower, bindscrolltoupper]);
  const touch = useTouchProps(extractTouchBindings(rest));

  return (
    <div
      id={id}
      className={className}
      style={{ overflowY: scrollY ? "auto" : "hidden", overflowX: scrollX ? "auto" : "hidden", ...style }}
      onScroll={handleScroll}
      onClick={tapHandler(bindtap ?? catchtap)}
      {...touch}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swiper
// ---------------------------------------------------------------------------

interface SwiperProps extends WxBaseProps {
  indicatorDots?: boolean;
  autoplay?: boolean;
  interval?: number;
  current?: number;
  bindchange?: (e: unknown) => void;
}

export function Swiper({ id, className, style, children, indicatorDots, autoplay, interval = 3000, current = 0, bindchange }: SwiperProps) {
  const [idx, setIdx] = useState(current);
  const items = React.Children.toArray(children);

  useEffect(() => {
    if (!autoplay || items.length <= 1) return;
    const t = setInterval(() => {
      setIdx((i) => {
        const next = (i + 1) % items.length;
        bindchange && bindchange(makeWxEvent("change", { current: next, source: "autoplay" }, null));
        return next;
      });
    }, interval);
    return () => clearInterval(t);
  }, [autoplay, interval, items.length, bindchange]);

  return (
    <div id={id} className={className} style={{ position: "relative", overflow: "hidden", ...style }}>
      <div style={{ display: "flex", transition: "transform 0.3s", transform: `translateX(-${idx * 100}%)` }}>
        {items.map((child, i) => (
          <div key={i} style={{ minWidth: "100%", flexShrink: 0 }}>{child}</div>
        ))}
      </div>
      {indicatorDots && items.length > 1 && (
        <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 4 }}>
          {items.map((_, i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === idx ? "#fff" : "rgba(255,255,255,0.5)" }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SwiperItem({ children, style }: WxBaseProps) {
  return <div style={{ width: "100%", height: "100%", ...style }}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Navigator
// ---------------------------------------------------------------------------

interface NavigatorProps extends WxBaseProps {
  url?: string;
  openType?: "navigate" | "redirect" | "switchTab" | "reLaunch" | "navigateBack";
  delta?: number;
}

export function Navigator({ id, className, style, children, url, openType = "navigate", delta, bindtap }: NavigatorProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (bindtap) { bindtap(makeWxEvent("tap", {}, e.currentTarget)); return; }
    if (!url && openType !== "navigateBack") return;
    const wx = (window as unknown as { wx?: Record<string, (o: unknown) => void> }).wx;
    if (!wx) return;
    if (openType === "navigate") wx.navigateTo({ url });
    else if (openType === "redirect") wx.redirectTo({ url });
    else if (openType === "switchTab") wx.switchTab({ url });
    else if (openType === "reLaunch") wx.reLaunch({ url });
    else if (openType === "navigateBack") wx.navigateBack({ delta: delta ?? 1 });
  };
  return (
    <a id={id} className={className} style={{ textDecoration: "none", color: "inherit", display: "block", ...style }} href={url ?? "#"} onClick={handleClick}>
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

interface FormProps extends WxBaseProps {
  bindsubmit?: (e: unknown) => void;
  bindreset?: (e: unknown) => void;
}

export function Form({ id, className, style, children, bindsubmit, bindreset }: FormProps) {
  return (
    <form
      id={id}
      className={className}
      style={style}
      onSubmit={(e) => { e.preventDefault(); bindsubmit && bindsubmit(makeWxEvent("submit", {}, e.currentTarget)); }}
      onReset={(e) => { bindreset && bindreset(makeWxEvent("reset", {}, e.currentTarget)); }}
    >
      {children}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Checkbox / Radio / Switch / Slider / Picker
// ---------------------------------------------------------------------------

interface CheckboxProps extends WxBaseProps {
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  bindchange?: (e: unknown) => void;
}

export function Checkbox({ id, className, style, value, checked, disabled, bindchange }: CheckboxProps) {
  const [localChecked, setLocalChecked] = useState(checked ?? false);
  useEffect(() => { setLocalChecked(checked ?? false); }, [checked]);
  return (
    <input
      id={id}
      className={className}
      style={style}
      type="checkbox"
      value={value}
      checked={localChecked}
      disabled={disabled}
      onChange={(e) => {
        setLocalChecked(e.target.checked);
        bindchange && bindchange(makeWxEvent("change", { value: e.target.checked ? [value] : [] }, e.currentTarget));
      }}
    />
  );
}

export function CheckboxGroup({ id, className, style, children }: WxBaseProps) {
  return <div id={id} className={className} style={style}>{children}</div>;
}

export function Radio({ id, className, style, value, checked, disabled, bindchange }: CheckboxProps) {
  return (
    <input
      id={id}
      className={className}
      style={style}
      type="radio"
      value={value}
      defaultChecked={checked}
      disabled={disabled}
      onChange={(e) => bindchange && bindchange(makeWxEvent("change", { value: e.target.value }, e.currentTarget))}
    />
  );
}

export function RadioGroup({ id, className, style, children, bindchange }: WxBaseProps & { bindchange?: (e: unknown) => void }) {
  return (
    <div id={id} className={className} style={style} onChange={(e) => {
      const target = e.target as HTMLInputElement;
      bindchange && bindchange(makeWxEvent("change", { value: target.value }, target));
    }}>
      {children}
    </div>
  );
}

interface SwitchProps extends WxBaseProps {
  checked?: boolean;
  disabled?: boolean;
  bindchange?: (e: unknown) => void;
}

export function Switch({ id, className, style, checked, disabled, bindchange }: SwitchProps) {
  const [on, setOn] = useState(checked ?? false);
  useEffect(() => { setOn(checked ?? false); }, [checked]);
  return (
    <input
      id={id}
      className={className}
      style={style}
      type="checkbox"
      role="switch"
      checked={on}
      disabled={disabled}
      onChange={(e) => {
        setOn(e.target.checked);
        bindchange && bindchange(makeWxEvent("change", { value: e.target.checked }, e.currentTarget));
      }}
    />
  );
}

interface SliderProps extends WxBaseProps {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  showValue?: boolean;
  bindchange?: (e: unknown) => void;
  bindchanging?: (e: unknown) => void;
}

export function Slider({ id, className, style, value = 0, min = 0, max = 100, step = 1, disabled, showValue, bindchange, bindchanging }: SliderProps) {
  const [val, setVal] = useState(value);
  useEffect(() => { setVal(value); }, [value]);
  return (
    <div id={id} className={className} style={{ display: "flex", alignItems: "center", gap: 8, ...style }}>
      <input
        type="range"
        style={{ flex: 1 }}
        value={val}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          setVal(v);
          bindchanging && bindchanging(makeWxEvent("changing", { value: v }, e.currentTarget));
        }}
        onMouseUp={(e) => bindchange && bindchange(makeWxEvent("change", { value: val }, e.currentTarget))}
        onTouchEnd={(e) => bindchange && bindchange(makeWxEvent("change", { value: val }, e.currentTarget))}
      />
      {showValue && <span style={{ fontSize: 14, minWidth: 28, textAlign: "right" }}>{val}</span>}
    </div>
  );
}

interface PickerProps extends WxBaseProps {
  range?: string[] | number[];
  value?: number;
  mode?: "selector" | "multiSelector" | "time" | "date" | "region";
  disabled?: boolean;
  bindchange?: (e: unknown) => void;
}

export function Picker({ id, className, style, children, range = [], value = 0, mode = "selector", disabled, bindchange }: PickerProps) {
  if (mode === "date" || mode === "time") {
    return (
      <div id={id} className={className} style={{ display: "inline-block", ...style }}>
        <input
          type={mode === "date" ? "date" : "time"}
          disabled={disabled}
          onChange={(e) => bindchange && bindchange(makeWxEvent("change", { value: e.target.value }, e.currentTarget))}
        />
        {children}
      </div>
    );
  }
  return (
    <div id={id} className={className} style={{ display: "inline-block", ...style }}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => bindchange && bindchange(makeWxEvent("change", { value: Number(e.target.value) }, e.currentTarget))}
      >
        {(range as string[]).map((item, i) => <option key={i} value={i}>{item}</option>)}
      </select>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

export function Label({ id, className, style, children, bindtap, catchtap }: WxBaseProps) {
  return (
    <label id={id} className={className} style={style} onClick={tapHandler(bindtap ?? catchtap)}>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

const ICON_CHARS: Record<string, string> = {
  success: "✓", success_no_circle: "✓", info: "ℹ", warn: "⚠", waiting: "⏳",
  cancel: "✕", download: "↓", search: "🔍", clear: "✕",
};

interface IconProps {
  type?: string;
  size?: number;
  color?: string;
}

export function Icon({ type = "info", size = 23, color }: IconProps) {
  return (
    <span style={{ fontSize: size, color: color ?? "#07c160", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {ICON_CHARS[type] ?? "●"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

interface ProgressProps {
  percent?: number;
  showInfo?: boolean;
  strokeWidth?: number;
  activeColor?: string;
  backgroundColor?: string;
}

export function Progress({ percent = 0, showInfo, strokeWidth = 6, activeColor = "#09BB07", backgroundColor = "#EBEBEB" }: ProgressProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: strokeWidth, background: backgroundColor, borderRadius: strokeWidth }}>
        <div style={{ width: `${Math.min(100, Math.max(0, percent))}%`, height: "100%", background: activeColor, borderRadius: strokeWidth, transition: "width 0.3s" }} />
      </div>
      {showInfo && <span style={{ fontSize: 12, minWidth: 36 }}>{percent}%</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block (transparent wrapper)
// ---------------------------------------------------------------------------

export function Block({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Canvas — real <canvas> element so wx.createSelectorQuery can return it and
// game code can call getContext('2d'). Accepts touch bindings for games.
// ---------------------------------------------------------------------------

interface CanvasProps extends WxBaseProps {
  width?: number | string;
  height?: number | string;
}

export function Canvas({ id, className, style, width, height, bindtap, catchtap, ...rest }: CanvasProps) {
  const touch = useTouchProps(extractTouchBindings(rest));
  return (
    <canvas
      id={id}
      className={className}
      width={typeof width === "number" ? width : undefined}
      height={typeof height === "number" ? height : undefined}
      style={{ display: "block", width: "100%", height: "100%", ...style }}
      onClick={tapHandler(bindtap ?? catchtap)}
      {...touch}
    />
  );
}

// ---------------------------------------------------------------------------
// Exports map used by wxml-to-jsx.ts
// ---------------------------------------------------------------------------

export const WX_COMPONENTS: Record<string, React.ComponentType<unknown>> = {
  view: View as React.ComponentType<unknown>,
  text: Text as React.ComponentType<unknown>,
  image: Image as React.ComponentType<unknown>,
  button: Button as React.ComponentType<unknown>,
  input: Input as React.ComponentType<unknown>,
  textarea: Textarea as React.ComponentType<unknown>,
  "scroll-view": ScrollView as React.ComponentType<unknown>,
  swiper: Swiper as React.ComponentType<unknown>,
  "swiper-item": SwiperItem as React.ComponentType<unknown>,
  navigator: Navigator as React.ComponentType<unknown>,
  form: Form as React.ComponentType<unknown>,
  label: Label as React.ComponentType<unknown>,
  checkbox: Checkbox as React.ComponentType<unknown>,
  "checkbox-group": CheckboxGroup as React.ComponentType<unknown>,
  radio: Radio as React.ComponentType<unknown>,
  "radio-group": RadioGroup as React.ComponentType<unknown>,
  switch: Switch as React.ComponentType<unknown>,
  slider: Slider as React.ComponentType<unknown>,
  picker: Picker as React.ComponentType<unknown>,
  icon: Icon as React.ComponentType<unknown>,
  progress: Progress as React.ComponentType<unknown>,
  block: Block as React.ComponentType<unknown>,
  canvas: Canvas as React.ComponentType<unknown>,
};
