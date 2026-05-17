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
  const mark: Record<string, string> = {};
  if (el && el instanceof HTMLElement) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-wx-mark-")) {
        const key = attr.name.slice(13).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        mark[key] = attr.value;
      } else if (attr.name.startsWith("data-wx-")) {
        const key = attr.name.slice(8).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        dataset[key] = attr.value;
      }
    }
  }
  return { type, timeStamp: Date.now(), detail, mark, target: { dataset, markMap: mark }, currentTarget: { dataset, markMap: mark } };
}

function tapHandler(handler?: (e: unknown) => void, stopProp = false) {
  if (!handler) return undefined;
  return (e: React.MouseEvent) => {
    if (stopProp) e.stopPropagation();
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
  "bindanimationstart", "bindanimationiteration", "bindanimationend",
  "bindtransitionend",
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
  const animStart = rest.bindanimationstart as ((e: unknown) => void) | undefined;
  const animIter  = rest.bindanimationiteration as ((e: unknown) => void) | undefined;
  const animEnd   = rest.bindanimationend as ((e: unknown) => void) | undefined;
  const transEnd  = rest.bindtransitionend as ((e: unknown) => void) | undefined;
  const hoverClass = rest.hoverClass as string | undefined;
  const hoverStopPropagation = !!(rest.hoverStopPropagation);
  const [hovered, setHovered] = useState(false);

  // animation prop from wx.createAnimation().export() — apply the last step's styles.
  const animProp = rest.animation as { actions?: Array<{ animates?: Array<{ type: string; value: unknown }> }> } | undefined;
  const animStyle: React.CSSProperties = {};
  if (animProp?.actions?.length) {
    const lastAction = animProp.actions[animProp.actions.length - 1];
    for (const { type, value } of lastAction.animates ?? []) {
      if (type === "opacity") animStyle.opacity = value as number;
      else if (type === "backgroundColor") animStyle.backgroundColor = value as string;
      else if (type === "width") animStyle.width = value as string;
      else if (type === "height") animStyle.height = value as string;
      else if (type === "transform") animStyle.transform = value as string;
    }
  }

  return (
    <div
      id={id}
      className={[className, hoverClass && hovered ? hoverClass : ""].filter(Boolean).join(" ") || undefined}
      style={{ ...style, ...animStyle }}
      onClick={tapHandler(bindtap ?? catchtap, !bindtap && !!catchtap)}
      onAnimationStart={animStart ? (e) => animStart(makeWxEvent("animationstart", { animationName: e.animationName }, e.currentTarget)) : undefined}
      onAnimationIteration={animIter ? (e) => animIter(makeWxEvent("animationiteration", { animationName: e.animationName }, e.currentTarget)) : undefined}
      onAnimationEnd={animEnd ? (e) => animEnd(makeWxEvent("animationend", { animationName: e.animationName }, e.currentTarget)) : undefined}
      onTransitionEnd={transEnd ? (e) => transEnd(makeWxEvent("transitionend", { propertyName: e.propertyName, elapsedTime: e.elapsedTime }, e.currentTarget)) : undefined}
      onMouseDown={hoverClass ? (e) => { if (hoverStopPropagation) e.stopPropagation(); setHovered(true); } : undefined}
      onMouseUp={hoverClass ? () => setHovered(false) : undefined}
      onMouseLeave={hoverClass ? () => setHovered(false) : undefined}
      {...touch}
      {...dataAttrs}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

interface TextProps extends WxBaseProps {
  selectable?: boolean;
  space?: "ensp" | "emsp" | "nbsp";
  decode?: boolean;
  numberOfLines?: number;
}

export function Text({ id, className, style, children, bindtap, catchtap, selectable, space, numberOfLines, ...rest }: TextProps) {
  const dataAttrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (k.startsWith("data-")) dataAttrs[k] = String(v ?? "");
  }
  const touch = useTouchProps(extractTouchBindings(rest));

  const textStyle: React.CSSProperties = {
    ...style,
    ...(selectable ? { userSelect: "text", WebkitUserSelect: "text" } : {}),
    ...(numberOfLines != null ? {
      display: "-webkit-box",
      WebkitLineClamp: numberOfLines,
      WebkitBoxOrient: "vertical",
      overflow: "hidden",
    } : {}),
  };

  return (
    <span id={id} className={className} style={textStyle} onClick={tapHandler(bindtap ?? catchtap, !bindtap && !!catchtap)} {...touch} {...dataAttrs}>
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

// Maps WeChat mode → CSS objectFit + objectPosition
const MODE_STYLE: Record<ImageMode, React.CSSProperties> = {
  scaleToFill:   { objectFit: "fill" },
  aspectFit:     { objectFit: "contain" },
  aspectFill:    { objectFit: "cover" },
  widthFix:      { objectFit: "fill", height: "auto" },
  heightFix:     { objectFit: "fill", width: "auto" },
  top:           { objectFit: "none", objectPosition: "top center" },
  bottom:        { objectFit: "none", objectPosition: "bottom center" },
  center:        { objectFit: "none", objectPosition: "center center" },
  left:          { objectFit: "none", objectPosition: "center left" },
  right:         { objectFit: "none", objectPosition: "center right" },
  "top left":    { objectFit: "none", objectPosition: "top left" },
  "top right":   { objectFit: "none", objectPosition: "top right" },
  "bottom left": { objectFit: "none", objectPosition: "bottom left" },
  "bottom right":{ objectFit: "none", objectPosition: "bottom right" },
};

interface ImageProps extends WxBaseProps {
  src?: string;
  mode?: ImageMode;
  lazyLoad?: boolean;
  bindload?: (e: unknown) => void;
  binderror?: (e: unknown) => void;
}

export function Image({ id, className, style, src, mode = "scaleToFill", lazyLoad, bindtap, catchtap, bindload, binderror, ...rest }: ImageProps) {
  const modeStyle = MODE_STYLE[mode] ?? { objectFit: "fill" };
  const touch = useTouchProps(extractTouchBindings(rest));
  return (
    <img
      id={id}
      className={className}
      src={src}
      loading={lazyLoad ? "lazy" : undefined}
      style={{ display: "block", width: "100%", height: "100%", ...modeStyle, ...style }}
      onClick={tapHandler(bindtap ?? catchtap, !bindtap && !!catchtap)}
      onLoad={(e) => bindload?.(makeWxEvent("load", { width: (e.target as HTMLImageElement).naturalWidth, height: (e.target as HTMLImageElement).naturalHeight }, e.currentTarget))}
      onError={(e) => binderror?.(makeWxEvent("error", { errMsg: "load failed" }, e.currentTarget))}
      {...touch}
      alt=""
    />
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonOpenType =
  | "getUserInfo" | "getPhoneNumber" | "openSetting" | "feedback"
  | "contact" | "launchApp" | "openGroupProfile" | "chooseAvatar"
  | "navigate" | "redirect" | "switchTab" | "reLaunch" | "navigateBack";

interface ButtonProps extends WxBaseProps {
  type?: "primary" | "default" | "warn";
  size?: "default" | "mini";
  disabled?: boolean;
  loading?: boolean;
  openType?: ButtonOpenType;
  formType?: "submit" | "reset";
  bindgetuserinfo?: (e: unknown) => void;
  bindgetphonenumber?: (e: unknown) => void;
  bindopensetting?: (e: unknown) => void;
  bindchooseavatar?: (e: unknown) => void;
  binderror?: (e: unknown) => void;
}

export function Button({ id, className, style, children, bindtap, catchtap, type = "default", size = "default", disabled, loading, openType, formType, bindgetuserinfo, bindgetphonenumber, bindopensetting, bindchooseavatar, ...rest }: ButtonProps) {
  const hoverClass = rest.hoverClass as string | undefined;
  const [hovered, setHovered] = useState(false);
  const isMini = size === "mini";
  const baseStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: isMini ? "0 16px" : "0 32px",
    height: isMini ? "30px" : "44px",
    borderRadius: isMini ? "15px" : "4px",
    fontSize: isMini ? "13px" : "18px",
    fontWeight: 500, border: "none", cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    background: type === "primary" ? "#07c160" : type === "warn" ? "#e64340" : "#f5f5f5",
    color: type === "default" ? "#333" : "#fff",
    ...style,
  };
  const touch = useTouchProps(extractTouchBindings(rest));

  const handleClick = disabled ? undefined : (e: React.MouseEvent<HTMLButtonElement>) => {
    // Handle open-type actions by delegating to wx polyfill equivalents.
    if (openType === "getUserInfo") {
      (window as unknown as { wx?: { getUserInfo: (o: unknown) => void } }).wx?.getUserInfo({ success: (r: unknown) => bindgetuserinfo?.(makeWxEvent("getuserinfo", r as Record<string, unknown>, e.currentTarget)) });
      return;
    }
    if (openType === "getPhoneNumber") {
      bindgetphonenumber?.(makeWxEvent("getphonenumber", { errMsg: "getPhoneNumber:fail not supported in preview" }, e.currentTarget));
      return;
    }
    if (openType === "openSetting") {
      (window as unknown as { wx?: { openSetting: (o: unknown) => void } }).wx?.openSetting({ success: (r: unknown) => bindopensetting?.(makeWxEvent("opensetting", r as Record<string, unknown>, e.currentTarget)) });
      return;
    }
    if (openType === "chooseAvatar") {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) {
          const url = URL.createObjectURL(file);
          bindchooseavatar?.(makeWxEvent("chooseavatar", { avatarUrl: url }, e.currentTarget));
        }
      };
      input.click();
      return;
    }
    // Navigation open-types — delegate to wx polyfill
    if (openType === "navigate" || openType === "redirect" || openType === "switchTab" || openType === "reLaunch" || openType === "navigateBack") {
      const wx = (window as unknown as { wx?: Record<string, (o: unknown) => void> }).wx;
      if (wx) {
        const url = (rest as Record<string, unknown>).url as string | undefined;
        if (openType === "navigate") wx.navigateTo?.({ url });
        else if (openType === "redirect") wx.redirectTo?.({ url });
        else if (openType === "switchTab") wx.switchTab?.({ url });
        else if (openType === "reLaunch") wx.reLaunch?.({ url });
        else if (openType === "navigateBack") wx.navigateBack?.({ delta: 1 });
      }
      return;
    }
    tapHandler(bindtap ?? catchtap, !bindtap && !!catchtap)?.(e);
  };

  return (
    <button
      id={id}
      className={[className, hoverClass && hovered ? hoverClass : ""].filter(Boolean).join(" ") || undefined}
      style={baseStyle}
      disabled={disabled}
      type={formType === "submit" ? "submit" : formType === "reset" ? "reset" : "button"}
      onClick={handleClick}
      onMouseDown={hoverClass && !disabled ? () => setHovered(true) : undefined}
      onMouseUp={hoverClass ? () => setHovered(false) : undefined}
      onMouseLeave={hoverClass ? () => setHovered(false) : undefined}
      {...touch}
    >
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

type ConfirmType = "send" | "search" | "next" | "go" | "done";

interface InputProps extends WxBaseProps {
  value?: string;
  placeholder?: string;
  placeholderStyle?: string;
  placeholderClass?: string;
  type?: "text" | "number" | "idcard" | "digit" | "tel" | "safe-password";
  password?: boolean;
  disabled?: boolean;
  maxlength?: number;
  confirmType?: ConfirmType;
  confirmHold?: boolean;
  cursor?: number;
  selectionStart?: number;
  selectionEnd?: number;
  adjustPosition?: boolean;
  autoFocus?: boolean;
  focus?: boolean;
  bindinput?: (e: unknown) => void;
  bindchange?: (e: unknown) => void;
  bindfocus?: (e: unknown) => void;
  bindblur?: (e: unknown) => void;
  bindconfirm?: (e: unknown) => void;
  bindkeyboardheightchange?: (e: unknown) => void;
}

// Maps WeChat confirm-type to HTML enterkeyhint (shows correct key on mobile keyboards).
const CONFIRM_TYPE_MAP: Record<ConfirmType, React.InputHTMLAttributes<HTMLInputElement>["enterKeyHint"]> = {
  send: "send", search: "search", next: "next", go: "go", done: "done",
};

export function Input({ id, className, style, value, placeholder, placeholderStyle, placeholderClass, type = "text", password, disabled, maxlength, confirmType, autoFocus, focus, selectionStart, selectionEnd, bindinput, bindchange, bindfocus, bindblur, bindconfirm }: InputProps) {
  const [localVal, setLocalVal] = useState(value ?? "");
  useEffect(() => { setLocalVal(value ?? ""); }, [value]);

  const htmlType = password || type === "safe-password" ? "password"
    : type === "digit" || type === "number" ? "number"
    : type === "tel" ? "tel"
    : "text"; // nickname, idcard, text all map to text

  // Inject placeholder styles via a <style> tag scoped to this input's id.
  const styleId = id ? `__wx_ph_${id}__` : null;
  const placeholderCss = (placeholderStyle || placeholderClass) && styleId
    ? `#${styleId}::placeholder { ${placeholderStyle ?? ""} }` + (placeholderClass ? ` #${styleId}::placeholder { /* class: ${placeholderClass} */ }` : "")
    : null;

  return (
    <>
      {placeholderCss && <style>{placeholderCss}</style>}
      <input
        id={styleId ?? id}
        className={className}
        style={{ display: "block", width: "100%", padding: "8px", border: "1px solid #ddd", borderRadius: "4px", fontSize: "14px", background: "#fff", ...style }}
        type={htmlType}
        value={localVal}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxlength}
        autoFocus={autoFocus || focus}
        enterKeyHint={confirmType ? CONFIRM_TYPE_MAP[confirmType] : undefined}
        ref={(el) => {
          if (el && selectionStart != null) {
            const end = selectionEnd ?? selectionStart;
            try { el.setSelectionRange(selectionStart, end); } catch {}
          }
        }}
        onChange={(e) => {
          setLocalVal(e.target.value);
          bindinput?.(makeWxEvent("input", { value: e.target.value }, e.currentTarget));
        }}
        onBlur={(e) => {
          bindchange?.(makeWxEvent("change", { value: e.target.value }, e.currentTarget));
          bindblur?.(makeWxEvent("blur", { value: e.target.value }, e.currentTarget));
        }}
        onFocus={(e) => bindfocus?.(makeWxEvent("focus", { value: e.target.value }, e.currentTarget))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            bindconfirm?.(makeWxEvent("confirm", { value: (e.target as HTMLInputElement).value }, e.currentTarget));
          }
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Textarea
// ---------------------------------------------------------------------------

interface TextareaProps extends WxBaseProps {
  value?: string;
  placeholder?: string;
  placeholderStyle?: string;
  placeholderClass?: string;
  disabled?: boolean;
  maxlength?: number;
  autoFocus?: boolean;
  focus?: boolean;
  autoHeight?: boolean;
  bindinput?: (e: unknown) => void;
  bindchange?: (e: unknown) => void;
  bindfocus?: (e: unknown) => void;
  bindblur?: (e: unknown) => void;
  bindlinechange?: (e: unknown) => void;
}

export function Textarea({ id, className, style, value, placeholder, placeholderStyle, placeholderClass, disabled, maxlength, autoFocus, focus, autoHeight, bindinput, bindchange, bindfocus, bindblur }: TextareaProps) {
  const [localVal, setLocalVal] = useState(value ?? "");
  useEffect(() => { setLocalVal(value ?? ""); }, [value]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const styleId = id ? `__wx_ta_${id}__` : null;
  const placeholderCss = (placeholderStyle || placeholderClass) && styleId
    ? `#${styleId}::placeholder { ${placeholderStyle ?? ""} }`
    : null;

  // auto-height: resize textarea to fit content.
  useEffect(() => {
    if (!autoHeight || !taRef.current) return;
    const el = taRef.current;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [localVal, autoHeight]);

  return (
    <>
      {placeholderCss && <style>{placeholderCss}</style>}
      <textarea
        ref={taRef}
        id={styleId ?? id}
        className={className}
        style={{ display: "block", width: "100%", padding: "8px", border: "1px solid #ddd", borderRadius: "4px", fontSize: "14px", background: "#fff", resize: autoHeight ? "none" : "none", overflow: autoHeight ? "hidden" : "auto", ...style }}
        value={localVal}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxlength}
        autoFocus={autoFocus || focus}
        onChange={(e) => {
          setLocalVal(e.target.value);
          bindinput?.(makeWxEvent("input", { value: e.target.value }, e.currentTarget));
        }}
        onBlur={(e) => {
          bindchange?.(makeWxEvent("change", { value: e.target.value }, e.currentTarget));
          bindblur?.(makeWxEvent("blur", { value: e.target.value }, e.currentTarget));
        }}
        onFocus={(e) => bindfocus?.(makeWxEvent("focus", { value: e.target.value }, e.currentTarget))}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// ScrollView
// ---------------------------------------------------------------------------

interface ScrollViewProps extends WxBaseProps {
  scrollY?: boolean;
  scrollX?: boolean;
  scrollIntoView?: string;
  scrollTop?: number;
  lowerThreshold?: number;
  upperThreshold?: number;
  enableFlex?: boolean;
  refresherEnabled?: boolean;
  refresherThreshold?: number;
  refresherDefaultStyle?: "black" | "white" | "none";
  refresherBackground?: string;
  refresherTriggered?: boolean;
  bindscroll?: (e: unknown) => void;
  bindscrolltolower?: (e: unknown) => void;
  bindscrolltoupper?: (e: unknown) => void;
  bindrefresherrefresh?: (e: unknown) => void;
  bindrefresherrestore?: (e: unknown) => void;
  bindrefresherpulling?: (e: unknown) => void;
  bindrefresherabort?: (e: unknown) => void;
}

export function ScrollView({ id, className, style, children, scrollY, scrollX, scrollIntoView, scrollTop, lowerThreshold = 50, upperThreshold = 50, enableFlex, refresherEnabled, refresherTriggered, bindscroll, bindscrolltolower, bindscrolltoupper, bindrefresherrefresh, bindtap, catchtap, ...rest }: ScrollViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pulling, setPulling] = useState(0);
  const [refreshing, setRefreshing] = useState(!!refresherTriggered);
  const touchStartY = useRef<number | null>(null);

  // Sync refresherTriggered prop.
  useEffect(() => { setRefreshing(!!refresherTriggered); }, [refresherTriggered]);

  // Scroll to element by id when scrollIntoView changes.
  useEffect(() => {
    if (!scrollIntoView || !containerRef.current) return;
    const target = containerRef.current.querySelector(`#${CSS.escape(scrollIntoView)}`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [scrollIntoView]);

  // Scroll to top offset when scrollTop changes.
  useEffect(() => {
    if (scrollTop == null || !containerRef.current) return;
    containerRef.current.scrollTop = scrollTop;
  }, [scrollTop]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    bindscroll?.(makeWxEvent("scroll", { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth }, el));
    if (bindscrolltolower && el.scrollTop + el.clientHeight >= el.scrollHeight - lowerThreshold) {
      bindscrolltolower(makeWxEvent("scrolltolower", {}, el));
    }
    if (bindscrolltoupper && el.scrollTop <= upperThreshold) {
      bindscrolltoupper(makeWxEvent("scrolltoupper", {}, el));
    }
  }, [bindscroll, bindscrolltolower, bindscrolltoupper, lowerThreshold, upperThreshold]);

  const touch = useTouchProps(extractTouchBindings(rest));

  // Pull-to-refresh for ScrollView (refresher-enabled).
  const onTouchStart = refresherEnabled ? (e: React.TouchEvent<HTMLDivElement>) => {
    if (containerRef.current && containerRef.current.scrollTop > 0) return;
    touchStartY.current = e.touches[0].clientY;
  } : undefined;
  const onTouchMove = refresherEnabled ? (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartY.current == null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) setPulling(Math.min(dy * 0.5, 60));
  } : undefined;
  const onTouchEnd = refresherEnabled ? () => {
    if (touchStartY.current == null) { setPulling(0); return; }
    touchStartY.current = null;
    if (pulling >= 60) {
      setRefreshing(true);
      setPulling(60);
      bindrefresherrefresh?.(makeWxEvent("refresherrefresh", {}, null));
    } else {
      setPulling(0);
    }
  } : undefined;

  return (
    <div style={{ position: "relative", overflow: "hidden", ...style }}>
      {refresherEnabled && (pulling > 0 || refreshing) && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 40, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 1 }}>
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" style={{ animation: refreshing ? "__wx_spin__ 0.8s linear infinite" : "none", transform: !refreshing ? `rotate(${(pulling / 60) * 180}deg)` : undefined }}>
            <circle cx="16" cy="16" r="12" stroke="rgba(7,193,96,0.2)" strokeWidth="3" />
            <path d="M16 4a12 12 0 0 1 12 12" stroke="#07c160" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      )}
      <div
        ref={containerRef}
        id={id}
        className={className}
        style={{
          overflowY: scrollY ? "auto" : "hidden",
          overflowX: scrollX ? "auto" : "hidden",
          WebkitOverflowScrolling: "touch",
          display: enableFlex ? "flex" : undefined,
          transform: refresherEnabled && (pulling > 0 || refreshing) ? `translateY(${refreshing ? 40 : pulling}px)` : undefined,
          transition: touchStartY.current != null ? "none" : "transform 0.2s ease-out",
          height: "100%",
        } as React.CSSProperties}
        onScroll={handleScroll}
        onClick={tapHandler(bindtap ?? catchtap, !bindtap && !!catchtap)}
        onTouchStart={onTouchStart ?? touch.onTouchStart}
        onTouchMove={onTouchMove ?? touch.onTouchMove}
        onTouchEnd={onTouchEnd ?? touch.onTouchEnd}
        onTouchCancel={onTouchEnd ?? touch.onTouchCancel}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swiper — supports circular, vertical, and duration.
// ---------------------------------------------------------------------------

interface SwiperProps extends WxBaseProps {
  indicatorDots?: boolean;
  indicatorColor?: string;
  indicatorActiveColor?: string;
  autoplay?: boolean;
  interval?: number;
  duration?: number;
  current?: number;
  circular?: boolean;
  vertical?: boolean;
  previousMargin?: string;
  nextMargin?: string;
  bindchange?: (e: unknown) => void;
}

export function Swiper({ id, className, style, children, indicatorDots, indicatorColor = "rgba(0,0,0,.3)", indicatorActiveColor = "#000", autoplay, interval = 3000, duration = 500, current = 0, circular, vertical, previousMargin = "0px", nextMargin = "0px", bindchange }: SwiperProps) {
  const [idx, setIdx] = useState(current);
  const items = React.Children.toArray(children);
  const count = items.length;
  // Parse margin values (e.g. "20px" or "20rpx" → convert rpx to vw)
  const parsePx = (v: string) => v.replace(/(\d+(?:\.\d+)?)rpx/g, (_, n) => `${(parseFloat(n) / 7.5).toFixed(2)}vw`);

  const goTo = useCallback((next: number) => {
    const clamped = circular ? ((next % count) + count) % count : Math.max(0, Math.min(count - 1, next));
    setIdx(clamped);
    bindchange?.(makeWxEvent("change", { current: clamped, source: "autoplay" }, null));
  }, [circular, count, bindchange]);

  useEffect(() => {
    if (!autoplay || count <= 1) return;
    const t = setInterval(() => goTo(idx + 1), interval);
    return () => clearInterval(t);
  }, [autoplay, interval, idx, goTo, count]);

  const axis = vertical ? "Y" : "X";

  return (
    <div id={id} className={className} style={{ position: "relative", overflow: "hidden", ...style }}>
      <div style={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        transition: `transform ${duration}ms ease`,
        // Offset by previousMargin so the previous slide peeks in.
        transform: `translate${axis}(calc(-${idx * 100}% + ${parsePx(previousMargin)}))`,
        height: "100%",
      }}>
        {items.map((child, i) => (
          <div key={i} style={{
            minWidth: vertical ? "100%" : `calc(100% - ${parsePx(previousMargin)} - ${parsePx(nextMargin)})`,
            minHeight: vertical ? `calc(100% - ${parsePx(previousMargin)} - ${parsePx(nextMargin)})` : undefined,
            flexShrink: 0,
            height: "100%",
          }}>{child}</div>
        ))}
      </div>
      {indicatorDots && count > 1 && (
        <div style={{
          position: "absolute",
          ...(vertical ? { right: 8, top: 0, bottom: 0, flexDirection: "column" } : { bottom: 8, left: 0, right: 0 }),
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 4,
          pointerEvents: "none",
        }}>
          {items.map((_, i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === idx ? indicatorActiveColor : indicatorColor, transition: "background 0.3s" }} />
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

export function Navigator({ id, className, style, children, url, openType = "navigate", delta, bindtap, ...rest }: NavigatorProps) {
  const hoverClass = rest.hoverClass as string | undefined;
  const [hovered, setHovered] = useState(false);
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
    <a
      id={id}
      className={[className, hoverClass && hovered ? hoverClass : ""].filter(Boolean).join(" ") || undefined}
      style={{ textDecoration: "none", color: "inherit", display: "block", ...style }}
      href={url ?? "#"}
      onClick={handleClick}
      onMouseDown={hoverClass ? () => setHovered(true) : undefined}
      onMouseUp={hoverClass ? () => setHovered(false) : undefined}
      onMouseLeave={hoverClass ? () => setHovered(false) : undefined}
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Form — collects all named child inputs on submit
// ---------------------------------------------------------------------------

interface FormProps extends WxBaseProps {
  bindsubmit?: (e: unknown) => void;
  bindreset?: (e: unknown) => void;
  reportSubmit?: boolean;
}

export function Form({ id, className, style, children, bindsubmit, bindreset }: FormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      id={id}
      className={className}
      style={style}
      onSubmit={(e) => {
        e.preventDefault();
        if (!bindsubmit) return;
        // Collect all named form controls into a value map.
        const formValue: Record<string, unknown> = {};
        if (formRef.current) {
          const els = formRef.current.elements;
          for (let i = 0; i < els.length; i++) {
            const el = els[i] as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            const name = el.getAttribute("name") || el.id;
            if (!name) continue;
            if (el instanceof HTMLInputElement) {
              if (el.type === "checkbox") {
                // Collect checkbox-group values as array
                if (!(name in formValue)) formValue[name] = [];
                if (el.checked) (formValue[name] as string[]).push(el.value);
              } else if (el.type === "radio") {
                if (el.checked) formValue[name] = el.value;
              } else {
                formValue[name] = el.value;
              }
            } else {
              formValue[name] = el.value;
            }
          }
        }
        bindsubmit(makeWxEvent("submit", { value: formValue }, e.currentTarget));
      }}
      onReset={(e) => { bindreset?.(makeWxEvent("reset", {}, e.currentTarget)); }}
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
      name={id}
      value={value}
      checked={localChecked}
      disabled={disabled}
      onChange={(e) => {
        setLocalChecked(e.target.checked);
        bindchange?.(makeWxEvent("change", { value: e.target.checked ? [value] : [] }, e.currentTarget));
      }}
    />
  );
}

interface CheckboxGroupProps extends WxBaseProps {
  bindchange?: (e: unknown) => void;
}

export function CheckboxGroup({ id, className, style, children, bindchange }: CheckboxGroupProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!bindchange) return;
    // Collect all checked checkboxes within this group.
    const container = e.currentTarget.closest(`#${id}`) ?? e.currentTarget.parentElement;
    if (!container) return;
    const checked = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked"))
      .map((el) => el.value)
      .filter(Boolean);
    bindchange(makeWxEvent("change", { value: checked }, e.currentTarget));
  }, [bindchange, id]);

  return (
    <div id={id} className={className} style={style} onChange={handleChange as unknown as React.ChangeEventHandler<HTMLDivElement>}>
      {children}
    </div>
  );
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
      onChange={(e) => {
        // Only fire bindchange if this Radio is standalone (not inside a RadioGroup).
        // RadioGroup uses event delegation on its container div, so firing here too
        // would cause duplicate events. We detect RadioGroup by checking if the
        // closest ancestor with role="radiogroup" exists.
        const inGroup = !!e.currentTarget.closest("[data-wx-radiogroup]");
        if (!inGroup) bindchange?.(makeWxEvent("change", { value: e.target.value }, e.currentTarget));
      }}
    />
  );
}

export function RadioGroup({ id, className, style, children, bindchange }: WxBaseProps & { bindchange?: (e: unknown) => void }) {
  return (
    <div
      id={id}
      className={className}
      style={style}
      data-wx-radiogroup="1"
      onChange={(e) => {
        const target = e.target as HTMLInputElement;
        if (target.type === "radio" && target.checked) {
          bindchange?.(makeWxEvent("change", { value: target.value }, target));
        }
      }}
    >
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
  range?: string[] | number[] | Array<string[] | number[]>;
  rangeKey?: string;
  value?: number | number[] | string;
  mode?: "selector" | "multiSelector" | "time" | "date" | "region";
  start?: string;
  end?: string;
  fields?: "year" | "month" | "day";
  disabled?: boolean;
  bindchange?: (e: unknown) => void;
  bindcolumnchange?: (e: unknown) => void;
  bindcancel?: (e: unknown) => void;
}

export function Picker({ id, className, style, children, range = [], value = 0, mode = "selector", start, end, fields, disabled, bindchange, bindcolumnchange, bindcancel }: PickerProps) {
  // date / time — use native HTML inputs.
  if (mode === "date") {
    const dateType = fields === "year" ? "number" : fields === "month" ? "month" : "date";
    return (
      <div id={id} className={className} style={{ display: "inline-block", ...style }}>
        <input
          type={dateType === "number" ? "number" : dateType}
          min={start}
          max={end}
          disabled={disabled}
          defaultValue={typeof value === "string" ? value : undefined}
          onChange={(e) => bindchange?.(makeWxEvent("change", { value: e.target.value }, e.currentTarget))}
          style={{ fontSize: 14, padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4 }}
        />
        {children}
      </div>
    );
  }
  if (mode === "time") {
    return (
      <div id={id} className={className} style={{ display: "inline-block", ...style }}>
        <input
          type="time"
          min={start}
          max={end}
          disabled={disabled}
          defaultValue={typeof value === "string" ? value : undefined}
          onChange={(e) => bindchange?.(makeWxEvent("change", { value: e.target.value }, e.currentTarget))}
          style={{ fontSize: 14, padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4 }}
        />
        {children}
      </div>
    );
  }
  // multiSelector — render one <select> per column.
  if (mode === "multiSelector") {
    const cols = Array.isArray(range) && Array.isArray(range[0]) ? range as Array<string[] | number[]> : [range as string[] | number[]];
    const vals = Array.isArray(value) ? value as number[] : cols.map(() => 0);
    return (
      <div id={id} className={className} style={{ display: "flex", gap: 4, alignItems: "center", ...style }}>
        {cols.map((col, ci) => (
          <select
            key={ci}
            value={vals[ci] ?? 0}
            disabled={disabled}
            onChange={(e) => {
              const newVals = [...vals];
              newVals[ci] = Number(e.target.value);
              bindcolumnchange?.(makeWxEvent("columnchange", { column: ci, value: Number(e.target.value) }, e.currentTarget));
              bindchange?.(makeWxEvent("change", { value: newVals }, e.currentTarget));
            }}
            style={{ fontSize: 14, padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4 }}
          >
            {(col as Array<string | number>).map((item, i) => (
              <option key={i} value={i}>{String(item)}</option>
            ))}
          </select>
        ))}
        {children}
      </div>
    );
  }
  // region — three linked selects (province / city / district).
  // In preview we show a simple text input since we don't have the full region dataset.
  if (mode === "region") {
    return (
      <div id={id} className={className} style={{ display: "inline-flex", alignItems: "center", gap: 4, ...style }}>
        <input
          type="text"
          placeholder="省/市/区"
          disabled={disabled}
          defaultValue={Array.isArray(value) ? (value as unknown as string[]).join(" / ") : ""}
          onBlur={(e) => bindchange?.(makeWxEvent("change", { value: e.target.value.split(" / "), code: [], postcode: "" }, e.currentTarget))}
          style={{ fontSize: 14, padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4 }}
        />
        {children}
      </div>
    );
  }
  // selector (default) — single <select>.
  return (
    <div id={id} className={className} style={{ display: "inline-block", ...style }}>
      <select
        value={value as number}
        disabled={disabled}
        onChange={(e) => bindchange?.(makeWxEvent("change", { value: Number(e.target.value) }, e.currentTarget))}
        style={{ fontSize: 14, padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4 }}
      >
        {(range as Array<string | number>).map((item, i) => (
          <option key={i} value={i}>{String(item)}</option>
        ))}
      </select>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

interface LabelProps extends WxBaseProps {
  for?: string;
}

export function Label({ id, className, style, children, bindtap, catchtap, for: htmlFor }: LabelProps) {
  return (
    <label
      id={id}
      className={className}
      style={style}
      htmlFor={htmlFor}
      onClick={tapHandler(bindtap ?? catchtap, !bindtap && !!catchtap)}
    >
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
// type="2d" uses the standard 2D context; type="webgl" uses WebGL.
// ---------------------------------------------------------------------------

interface CanvasProps extends WxBaseProps {
  width?: number | string;
  height?: number | string;
  type?: "2d" | "webgl";
}

export function Canvas({ id, className, style, width, height, type, bindtap, catchtap, ...rest }: CanvasProps) {
  const touch = useTouchProps(extractTouchBindings(rest));
  // For webgl, set the canvas context type hint via a data attribute so
  // wx.createCanvasContext can pick it up.
  return (
    <canvas
      id={id}
      className={className}
      data-canvas-type={type ?? "2d"}
      width={typeof width === "number" ? width : undefined}
      height={typeof height === "number" ? height : undefined}
      style={{ display: "block", width: "100%", height: "100%", ...style }}
      onClick={tapHandler(bindtap ?? catchtap, !bindtap && !!catchtap)}
      {...touch}
    />
  );
}

// ---------------------------------------------------------------------------
// RichText — renders a WeChat node-tree or HTML string.
// Content is sanitised (scripts/styles/event-handlers stripped) before render.
// ---------------------------------------------------------------------------

interface RichTextNode {
  name?: string;
  type?: "node" | "text";
  text?: string;
  attrs?: Record<string, string>;
  children?: RichTextNode[];
}

function richNodesToHtml(nodes: RichTextNode[]): string {
  return nodes.map((n) => {
    if (n.type === "text" || !n.name) return n.text ?? "";
    const attrs = Object.entries(n.attrs ?? {})
      .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, "&quot;")}"`)
      .join("");
    const inner = n.children ? richNodesToHtml(n.children) : "";
    return `<${n.name}${attrs}>${inner}</${n.name}>`;
  }).join("");
}

const RICH_ALLOWED_TAGS = new Set([
  "a","abbr","b","blockquote","br","code","col","colgroup","dd","del","div",
  "dl","dt","em","fieldset","h1","h2","h3","h4","h5","h6","hr","i","img",
  "ins","label","legend","li","ol","p","q","s","small","span","strong","sub",
  "sup","table","tbody","td","tfoot","th","thead","tr","u","ul",
]);

function sanitiseRichHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/<(\/?)([\w-]+)/g, (_m, slash, tag) =>
      RICH_ALLOWED_TAGS.has(tag.toLowerCase()) ? `<${slash}${tag}` : `<!-- ${tag} `
    );
}

interface RichTextProps extends WxBaseProps {
  nodes?: RichTextNode[] | string;
  space?: string;
}

export function RichText({ id, className, style, nodes }: RichTextProps) {
  let html = "";
  if (typeof nodes === "string") {
    html = sanitiseRichHtml(nodes);
  } else if (Array.isArray(nodes)) {
    html = sanitiseRichHtml(richNodesToHtml(nodes));
  }
  // sanitiseRichHtml strips all scripts, styles, and event-handler attributes
  // before this content reaches dangerouslySetInnerHTML.
  return (
    <div
      id={id}
      className={className}
      style={{ wordBreak: "break-word", ...style }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ---------------------------------------------------------------------------
// Video — HTML5 <video> with WeChat-style controls.
// ---------------------------------------------------------------------------

interface VideoProps extends WxBaseProps {
  src?: string;
  poster?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  controls?: boolean;
  objectFit?: string;
  bindplay?: (e: unknown) => void;
  bindpause?: (e: unknown) => void;
  bindended?: (e: unknown) => void;
  binderror?: (e: unknown) => void;
  bindtimeupdate?: (e: unknown) => void;
}

export function Video({
  id, className, style, src, poster, autoplay, loop, muted,
  controls = true, objectFit = "contain",
  bindplay, bindpause, bindended, binderror, bindtimeupdate,
}: VideoProps) {
  return (
    <div id={id} className={className} style={{ position: "relative", background: "#000", ...style }}>
      <video
        src={src}
        poster={poster}
        autoPlay={autoplay}
        loop={loop}
        muted={muted}
        controls={controls}
        style={{ width: "100%", height: "100%", objectFit: (objectFit as React.CSSProperties["objectFit"]) }}
        onPlay={(e) => bindplay?.(makeWxEvent("play", {}, e.currentTarget))}
        onPause={(e) => bindpause?.(makeWxEvent("pause", {}, e.currentTarget))}
        onEnded={(e) => bindended?.(makeWxEvent("ended", {}, e.currentTarget))}
        onError={(e) => binderror?.(makeWxEvent("error", {}, e.currentTarget))}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          bindtimeupdate?.(makeWxEvent("timeupdate", { currentTime: v.currentTime, duration: v.duration }, v));
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WebView — renders an iframe for <web-view src="...">.
// ---------------------------------------------------------------------------

interface WebViewProps extends WxBaseProps {
  src?: string;
}

export function WebView({ id, className, style, src }: WebViewProps) {
  if (!src) {
    return (
      <View id={id} className={className} style={style}>
        <Text style={{ color: "#999", fontSize: 12 }}>web-view: no src</Text>
      </View>
    );
  }
  return (
    <iframe
      id={id}
      className={className}
      src={src}
      style={{ width: "100%", height: "100%", border: "none", ...style }}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      title="web-view"
    />
  );
}

// ---------------------------------------------------------------------------
// MovableArea / MovableView — drag-and-drop container.
// ---------------------------------------------------------------------------

export function MovableArea({ id, className, style, children }: WxBaseProps) {
  return (
    <div id={id} className={className} style={{ position: "relative", overflow: "hidden", ...style }}>
      {children}
    </div>
  );
}

interface MovableViewProps extends WxBaseProps {
  direction?: "all" | "vertical" | "horizontal" | "none";
  x?: number;
  y?: number;
  bindchange?: (e: unknown) => void;
}

export function MovableView({
  id, className, style, children,
  direction = "all", x = 0, y = 0, bindchange,
}: MovableViewProps) {
  const [pos, setPos] = useState({ x, y });
  const startRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!startRef.current) return;
      const dx = direction !== "vertical" ? ev.clientX - startRef.current.mx : 0;
      const dy = direction !== "horizontal" ? ev.clientY - startRef.current.my : 0;
      const nx = startRef.current.px + dx;
      const ny = startRef.current.py + dy;
      setPos({ x: nx, y: ny });
      bindchange?.(makeWxEvent("change", { x: nx, y: ny, source: "touch" }, null));
    };
    const onUp = () => {
      startRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      id={id}
      className={className}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        cursor: direction === "none" ? "default" : "grab",
        userSelect: "none",
        ...style,
      }}
      onMouseDown={direction !== "none" ? onMouseDown : undefined}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CoverView / CoverImage — overlay components (render as View/Image).
// ---------------------------------------------------------------------------

export function CoverView({ id, className, style, children, bindtap, catchtap }: WxBaseProps) {
  return (
    <div
      id={id}
      className={className}
      style={{ position: "absolute", ...style }}
      onClick={tapHandler(bindtap ?? catchtap, !bindtap && !!catchtap)}
    >
      {children}
    </div>
  );
}

interface CoverImageProps extends WxBaseProps {
  src?: string;
}

export function CoverImage({ id, className, style, src, bindtap, catchtap }: CoverImageProps) {
  return (
    <img
      id={id}
      className={className}
      src={src}
      alt=""
      style={{ position: "absolute", display: "block", ...style }}
      onClick={tapHandler(bindtap ?? catchtap, !bindtap && !!catchtap)}
    />
  );
}

// ---------------------------------------------------------------------------
// Stubs for components that require native capabilities.
// ---------------------------------------------------------------------------

function UnavailableStub({ label }: { label: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "#1a1a1a", color: "#666", fontSize: 11,
      padding: "8px 12px", borderRadius: 4, fontFamily: "monospace",
    }}>
      {label} (preview unavailable)
    </div>
  );
}

export function LivePlayerStub(_props: WxBaseProps) {
  return <UnavailableStub label="live-player" />;
}

export function AdStub(_props: WxBaseProps) {
  return <UnavailableStub label="ad" />;
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
  "rich-text": RichText as React.ComponentType<unknown>,
  video: Video as React.ComponentType<unknown>,
  "web-view": WebView as React.ComponentType<unknown>,
  "movable-view": MovableView as React.ComponentType<unknown>,
  "movable-area": MovableArea as React.ComponentType<unknown>,
  "cover-view": CoverView as React.ComponentType<unknown>,
  "cover-image": CoverImage as React.ComponentType<unknown>,
  "live-player": LivePlayerStub as React.ComponentType<unknown>,
  "live-pusher": LivePlayerStub as React.ComponentType<unknown>,
  ad: AdStub as React.ComponentType<unknown>,
  "official-account": AdStub as React.ComponentType<unknown>,
};
