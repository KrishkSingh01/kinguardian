"""Static contrast, focus, reduced-motion, and responsive-layout checks."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def variables(block: str) -> dict[str, str]:
    return dict(re.findall(r"(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;", block))


def luminance(hex_color: str) -> float:
    rgb = [int(hex_color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    channels = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in rgb]
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast(foreground: str, background: str) -> float:
    first, second = luminance(foreground), luminance(background)
    return (max(first, second) + 0.05) / (min(first, second) + 0.05)


def require_contrast(theme: str, foreground: str, background: str, minimum: float) -> None:
    value = contrast(foreground, background)
    if value < minimum:
        raise AssertionError(f"{theme} contrast {foreground} on {background} is {value:.2f}:1; need {minimum:.1f}:1")


def main() -> None:
    tokens = (ROOT / "css" / "tokens.css").read_text(encoding="utf-8")
    light_match = re.search(r"(?m)^:root\s*\{([^}]+)\}", tokens)
    dark_match = re.search(r'(?m)^:root\[data-theme="dark"\]\s*\{([^}]+)\}', tokens)
    if not light_match or not dark_match:
        raise AssertionError("Could not read both light and dark design tokens")

    themes = {"light": variables(light_match.group(1)), "dark": variables(dark_match.group(1))}
    for theme, color in themes.items():
        surface = color["--surface"]
        paper = color["--paper"]
        require_contrast(theme, color["--ink"], paper, 4.5)
        require_contrast(theme, color["--ink-soft"], surface, 4.5)
        require_contrast(theme, color["--ink-muted"], surface, 4.5)
        require_contrast(theme, color["--coral-text"], color["--coral-pale"], 4.5)
        require_contrast(theme, color["--coral-ink"], color["--coral"], 4.5)
        require_contrast(theme, color["--line-strong"], surface, 3.0)
        require_contrast(theme, color["--focus-ring"], surface, 3.0)

    base = (ROOT / "css" / "base.css").read_text(encoding="utf-8")
    animations = (ROOT / "css" / "animations.css").read_text(encoding="utf-8")
    responsive = (ROOT / "css" / "responsive.css").read_text(encoding="utf-8")
    notification_css = (ROOT / "css" / "notifications.css").read_text(encoding="utf-8")
    for required in ("button:focus-visible", "a:focus-visible", "input:focus-visible", "textarea:focus-visible", "select:focus-visible", "--focus-ring"):
        if required not in base:
            raise AssertionError(f"Keyboard focus styling is missing {required}")
    if "prefers-reduced-motion: reduce" not in animations:
        raise AssertionError("Motion styles must respect reduced-motion preferences")
    for breakpoint in ("max-width: 1160px", "max-width: 850px", "max-width: 680px", "max-width: 390px"):
        if breakpoint not in responsive:
            raise AssertionError(f"Responsive layout is missing its {breakpoint} breakpoint")
    if "max-width: 620px" not in notification_css:
        raise AssertionError("Notification settings need a narrow-screen layout")

    index = (ROOT / "dashboard.html").read_text(encoding="utf-8")
    desktop_nav = re.findall(r"<button\b[^>]*class=\"nav-item[^>]*>", index)
    if not desktop_nav or any("aria-label=" not in button for button in desktop_nav):
        raise AssertionError("Icon-only tablet navigation buttons need explicit accessible names")

    page_size = sum(path.stat().st_size for path in (ROOT / "css").glob("*.css"))
    if page_size > 200_000:
        raise AssertionError(f"CSS source exceeds the 200 KB lightweight prototype budget: {page_size} bytes")
    print(f"PASS: light/dark text and control contrast, keyboard focus, reduced motion, tablet/mobile breakpoints, named tablet navigation, and {page_size:,} CSS bytes checked.")


if __name__ == "__main__":
    main()
